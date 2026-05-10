"""FastAPI application: /judge and /admin APIs."""
import csv
import io
import json
import os
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import qrcode
from fastapi import FastAPI, HTTPException, Depends, Query, Request
from fastapi.responses import Response, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from database import get_conn, init_db, start_backup_scheduler, stop_backup_scheduler, tx, insert_returning_id
from models import (
    EventIn, EventOut, JudgeIn, ProjectIn, ScoreIn,
    PinAuthIn, AdminAuthIn, ProjectsImportIn, JudgesImportIn, ScrapeIn,
    TeamSubmitIn,
)
from auth import (
    make_judge_token, make_admin_token, hash_token,
    verify_password, verify_pin, require_judge, require_admin, require_admin_q,
    generate_pin, is_valid_pin, normalize_pin,
)
from scrape_devpost import scrape_event
import sheets_backup

WEIGHTS = {"innovation": 0.25, "technical": 0.25, "impact": 0.25, "presentation": 0.25}
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173")


@asynccontextmanager
async def lifespan(app: FastAPI):
    import database as _db
    backend = "postgres" if _db.USE_PG else "sqlite"
    print(f"[boot] DB backend: {backend}")
    if backend == "sqlite" and os.environ.get("RAILWAY_ENVIRONMENT"):
        print("[boot] WARNING: running on Railway with SQLite — filesystem is "
              "ephemeral. Attach a Postgres plugin and set DATABASE_URL.")
    if sheets_backup.is_configured():
        print("[boot] Google Sheets backup: enabled")
    init_db()
    _maybe_auto_seed()
    _migrate_legacy_pins_to_random()
    _rename_legacy_event()
    start_backup_scheduler()
    _start_pending_sync_retry_loop()
    yield
    _stop_pending_sync_retry_loop()
    stop_backup_scheduler()


def _rename_legacy_event() -> None:
    """Idempotent: rename the seeded 'cmd-f 2025' event if it's still around."""
    try:
        with tx() as c:
            c.execute(
                "UPDATE events SET name = ? WHERE name = ?",
                ("Hackathon May 9-10", "cmd-f 2025"),
            )
    except Exception as e:
        print(f"[boot] event rename skipped: {e}")


def _migrate_legacy_pins_to_random() -> None:
    """Idempotent: any judge whose stored pin isn't already a 6-digit numeric
    PIN gets re-issued a random one. Catches old name-derived PINs from before
    the random-PIN switch.
    """
    try:
        conn = get_conn()
        rows = conn.execute("SELECT id, pin FROM judges").fetchall()
        used = {r["pin"] for r in rows if is_valid_pin(r["pin"] or "")}
        targets = [r for r in rows if not is_valid_pin(r["pin"] or "")]
        if not targets:
            return
        with tx() as c:
            for r in targets:
                new_pin = generate_pin(used)
                c.execute("UPDATE judges SET pin = ? WHERE id = ?", (new_pin, r["id"]))
        print(f"[boot] migrated {len(targets)} legacy PIN(s) to random 6-digit codes")
    except Exception as e:
        print(f"[boot] PIN migration skipped: {e}")


def _maybe_auto_seed() -> None:
    """If the DB is empty, populate dummy event/judges/projects/scores."""
    if os.environ.get("SKIP_AUTO_SEED") == "1":
        return
    try:
        row = get_conn().execute("SELECT COUNT(*) AS n FROM events").fetchone()
        if row and (row["n"] if isinstance(row, dict) else row[0]) > 0:
            return
        from seed import seed as _seed  # local import to avoid circular at module load
        print("[boot] empty DB detected — running seed.py for dummy data")
        _seed(wipe=False)
    except Exception as e:
        print(f"[boot] auto-seed skipped: {e}")


# ---------- Pending-sync retry (Sheets) ----------
import threading
import time as _time

_retry_stop = threading.Event()
_retry_thread: threading.Thread | None = None


def _pending_sync_rows(limit: int = 100) -> list[dict]:
    rows = get_conn().execute(
        """
        SELECT s.judge_id, s.project_id,
               s.innovation, s.technical, s.impact, s.presentation,
               s.total_weighted, s.notes, s.updated_at,
               p.title AS project_title, p.team_name, p.event_id
        FROM scores s
        JOIN projects p ON p.id = s.project_id
        WHERE s.sync_status = 'pending_sync'
        ORDER BY s.updated_at
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [dict(r) for r in rows]


def _retry_pending_once() -> dict:
    """One pass over pending_sync rows. Returns counts for the admin UI."""
    if not sheets_backup.is_configured():
        return {"attempted": 0, "succeeded": 0, "still_pending": 0, "skipped_unconfigured": True}
    rows = _pending_sync_rows()
    succeeded = 0
    for r in rows:
        score = {
            "innovation": r["innovation"], "technical": r["technical"],
            "impact": r["impact"], "presentation": r["presentation"],
            "total_weighted": r["total_weighted"], "notes": r["notes"] or "",
            "updated_at": r["updated_at"],
        }
        judge = {"id": r["judge_id"]}
        project = {"id": r["project_id"], "title": r["project_title"], "team_name": r["team_name"]}
        if sheets_backup.mirror_score_sync(score, judge, project):
            _mark_score_submitted(r["judge_id"], r["project_id"])
            succeeded += 1
    pending_remaining = get_conn().execute(
        "SELECT COUNT(*) AS n FROM scores WHERE sync_status = 'pending_sync'"
    ).fetchone()
    n = pending_remaining["n"] if isinstance(pending_remaining, dict) else pending_remaining[0]
    return {"attempted": len(rows), "succeeded": succeeded, "still_pending": n}


def _retry_loop() -> None:
    """Sweeps pending_sync rows every 30s with simple backoff on consecutive failures."""
    backoff = 30
    while not _retry_stop.is_set():
        try:
            res = _retry_pending_once()
            if res.get("attempted") and res["succeeded"] == 0:
                backoff = min(300, backoff * 2)  # cap at 5 minutes
            else:
                backoff = 30
        except Exception as e:
            print(f"[sheets-retry] loop error: {e}")
            backoff = min(300, backoff * 2)
        _retry_stop.wait(backoff)


def _start_pending_sync_retry_loop() -> None:
    global _retry_thread
    if _retry_thread and _retry_thread.is_alive():
        return
    _retry_stop.clear()
    _retry_thread = threading.Thread(target=_retry_loop, daemon=True)
    _retry_thread.start()


def _stop_pending_sync_retry_loop() -> None:
    _retry_stop.set()


app = FastAPI(title="Hackathon Judging Platform", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    """Health check + DB backend visibility for deployment dashboards."""
    import database as _db
    backend = "postgres" if _db.USE_PG else "sqlite"
    counts = {}
    try:
        for tbl in ("events", "judges", "projects", "scores"):
            row = get_conn().execute(f"SELECT COUNT(*) AS n FROM {tbl}").fetchone()
            counts[tbl] = row["n"] if isinstance(row, dict) else row[0]
    except Exception as e:
        counts = {"error": str(e)}
    return {
        "ok": True,
        "db": backend,
        "counts": counts,
        "sheets_backup": sheets_backup.is_configured(),
    }


# ---------- Public team submission ----------
def _latest_event() -> Optional[dict]:
    row = get_conn().execute(
        "SELECT * FROM events ORDER BY created_at DESC, id DESC LIMIT 1"
    ).fetchone()
    return dict(row) if row else None


@app.get("/api/submit/event")
def submit_event_info():
    ev = _latest_event()
    if not ev:
        return {"event": None}
    return {"event": {
        "id": ev["id"],
        "name": ev["name"],
        "date": ev.get("date") if isinstance(ev, dict) else ev["date"],
        "venue": ev.get("venue") if isinstance(ev, dict) else ev["venue"],
        "devpost_url": ev.get("devpost_url") if isinstance(ev, dict) else ev["devpost_url"],
    }}


@app.post("/api/submit")
def team_submit(body: TeamSubmitIn):
    """A team member registers their project for judging.

    Public, no auth. Idempotent on (event_id, devpost_url) — teams can resubmit
    to update their table number or fix typos.
    """
    title = (body.title or "").strip()
    devpost = (body.devpost_url or "").strip()
    table = (body.table_number or "").strip()
    team = (body.team_name or "").strip()
    track = (body.track or "").strip()
    if not title:
        raise HTTPException(400, "missing project title")
    if not devpost:
        raise HTTPException(400, "missing Devpost link")
    if not (devpost.startswith("http://") or devpost.startswith("https://")):
        raise HTTPException(400, "devpost link must start with http:// or https://")
    if not table:
        raise HTTPException(400, "missing table number")
    if not team:
        raise HTTPException(400, "missing team name")
    if not track:
        raise HTTPException(400, "missing device number")

    if body.event_id is not None:
        ev_row = get_conn().execute(
            "SELECT * FROM events WHERE id = ?", (body.event_id,)
        ).fetchone()
        if not ev_row:
            raise HTTPException(404, "event not found")
        eid = body.event_id
    else:
        ev = _latest_event()
        if not ev:
            raise HTTPException(404, "no event open for submissions")
        eid = ev["id"]

    desc = (body.description or "").strip() or None

    with tx() as c:
        if c.kind == "pg":
            c.execute(
                """INSERT INTO projects (event_id, title, team_name, table_number, track, description, devpost_url)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT (event_id, devpost_url) WHERE devpost_url IS NOT NULL DO UPDATE SET
                     title = EXCLUDED.title,
                     team_name = EXCLUDED.team_name,
                     table_number = EXCLUDED.table_number,
                     track = EXCLUDED.track,
                     description = EXCLUDED.description""",
                (eid, title, team, table, track, desc, devpost),
            )
        else:
            c.execute(
                """INSERT INTO projects (event_id, title, team_name, table_number, track, description, devpost_url)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT (event_id, devpost_url) WHERE devpost_url IS NOT NULL DO UPDATE SET
                     title = excluded.title,
                     team_name = excluded.team_name,
                     table_number = excluded.table_number,
                     track = excluded.track,
                     description = excluded.description""",
                (eid, title, team, table, track, desc, devpost),
            )
        row = c.execute(
            "SELECT * FROM projects WHERE event_id = ? AND devpost_url = ?",
            (eid, devpost),
        ).fetchone()
    project = dict(row)
    sheets_backup.mirror_submission(project)
    return {"ok": True, "project": project}


# ---------- Judge auth ----------
@app.post("/api/judge/auth/qr")
def judge_auth_qr(body: dict):
    token = body.get("token", "")
    from auth import _decode  # noqa
    payload = _decode(token)
    if payload.get("kind") != "judge":
        raise HTTPException(401, "wrong token kind")
    judge_id = int(payload["sub"])
    return _judge_bootstrap(judge_id, token)


_PIN_ATTEMPTS: dict[str, list[float]] = {}
_PIN_RATE_LIMIT = 10           # max attempts
_PIN_RATE_WINDOW_SEC = 60.0    # ...per this window, per IP


def _client_ip(request) -> str:
    # Honor X-Forwarded-For when running behind Railway/Cloudflare; first IP
    # in the chain is the original client.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_pin_rate_limit(ip: str) -> None:
    import time as _t
    now = _t.monotonic()
    window_start = now - _PIN_RATE_WINDOW_SEC
    bucket = [t for t in _PIN_ATTEMPTS.get(ip, []) if t >= window_start]
    if len(bucket) >= _PIN_RATE_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"too many attempts; wait a minute before trying again",
        )
    bucket.append(now)
    _PIN_ATTEMPTS[ip] = bucket


@app.post("/api/judge/auth/pin")
def judge_auth_pin(body: PinAuthIn, request: Request):
    """PIN-only judge login. Rate-limited per IP (10 attempts / 60s) so the
    6-digit space can't be brute-forced during the event."""
    _check_pin_rate_limit(_client_ip(request))
    pin = (body.pin or "").strip()
    if not pin:
        raise HTTPException(400, "missing pin")
    judge = verify_pin(pin, body.event_id)
    if not judge:
        raise HTTPException(401, "invalid pin")
    token = make_judge_token(judge["id"], judge["event_id"])
    return _judge_bootstrap(judge["id"], token)


def _judge_bootstrap(judge_id: int, token: str) -> dict:
    conn = get_conn()
    judge = conn.execute("SELECT * FROM judges WHERE id = ?", (judge_id,)).fetchone()
    if not judge:
        raise HTTPException(404, "judge not found")
    event = conn.execute("SELECT * FROM events WHERE id = ?", (judge["event_id"],)).fetchone()
    projects = conn.execute(
        """SELECT * FROM projects WHERE event_id = ?
           ORDER BY CAST(table_number AS INTEGER), title""",
        (judge["event_id"],),
    ).fetchall()
    scores = conn.execute("SELECT * FROM scores WHERE judge_id = ?", (judge_id,)).fetchall()
    return {
        "token": token,
        "judge": {k: judge[k] for k in judge.keys() if k not in ("token_hash",)},
        "event": dict(event) if event else None,
        "projects": [dict(p) for p in projects],
        "scores": [dict(s) for s in scores],
    }


@app.get("/api/judge/projects")
def judge_projects(judge=Depends(require_judge)):
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM projects WHERE event_id = ? ORDER BY CAST(table_number AS INTEGER), title",
        (judge["event_id"],),
    ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/judge/scores")
def judge_scores(judge=Depends(require_judge)):
    conn = get_conn()
    rows = conn.execute("SELECT * FROM scores WHERE judge_id = ?", (judge["id"],)).fetchall()
    return [dict(r) for r in rows]


def _compute_totals(s: ScoreIn) -> tuple[float, float]:
    raw = s.innovation + s.technical + s.impact + s.presentation
    weighted = (
        s.innovation * WEIGHTS["innovation"]
        + s.technical * WEIGHTS["technical"]
        + s.impact * WEIGHTS["impact"]
        + s.presentation * WEIGHTS["presentation"]
    )
    return raw, weighted


def _mark_score_submitted(judge_id: int, project_id: int) -> None:
    """Flip sync_status to 'submitted' once Sheets has confirmed the row."""
    with tx() as c:
        c.execute(
            "UPDATE scores SET sync_status = 'submitted' WHERE judge_id = ? AND project_id = ?",
            (judge_id, project_id),
        )


def _try_mirror_to_sheets(score: dict, judge: dict, project: dict) -> bool:
    """Synchronously push a single score to Sheets. Returns True on success
    (or when Sheets isn't configured — the row counts as submitted in that
    case). Logs and swallows errors so the request never fails on Sheets.
    """
    if not sheets_backup.is_configured():
        return True
    try:
        return sheets_backup.mirror_score_sync(score, judge, project)
    except Exception as e:
        print(f"[sheets] mirror_score_sync raised: {e}")
        return False


@app.post("/api/judge/scores")
def judge_post_score(body: ScoreIn, judge=Depends(require_judge)):
    """Three-layer reliability: DB write first (synchronous), Sheets second
    (synchronous), and only then mark the row 'submitted'. Sheets failure
    leaves the row as 'pending_sync' — the score is safe in the DB and the
    background retry loop will replay it.
    """
    conn = get_conn()
    project = conn.execute(
        "SELECT * FROM projects WHERE id = ? AND event_id = ?", (body.project_id, judge["event_id"])
    ).fetchone()
    if not project:
        raise HTTPException(404, "project not in this event")
    raw, weighted = _compute_totals(body)

    # (b) DB write before any confirmation. Initial status is pending_sync —
    # we'll flip it to 'submitted' below if Sheets returns OK.
    with tx() as c:
        c.execute(
            """
            INSERT INTO scores (judge_id, project_id, innovation, technical, impact, presentation,
                                total_raw, total_weighted, notes, sync_status, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_sync', CURRENT_TIMESTAMP)
            ON CONFLICT(judge_id, project_id) DO UPDATE SET
              innovation = excluded.innovation,
              technical  = excluded.technical,
              impact     = excluded.impact,
              presentation = excluded.presentation,
              total_raw  = excluded.total_raw,
              total_weighted = excluded.total_weighted,
              notes      = excluded.notes,
              updated_at = CURRENT_TIMESTAMP,
              sync_status = 'pending_sync'
            """,
            (
                judge["id"], body.project_id,
                body.innovation, body.technical, body.impact, body.presentation,
                raw, weighted, body.notes or "",
            ),
        )
        row = c.execute(
            "SELECT * FROM scores WHERE judge_id = ? AND project_id = ?",
            (judge["id"], body.project_id),
        ).fetchone()
    score = dict(row)

    # (c) Sheets sync, synchronous. Only flip to 'submitted' on success.
    if _try_mirror_to_sheets(score, dict(judge), dict(project)):
        _mark_score_submitted(judge["id"], body.project_id)
        score["sync_status"] = "submitted"
    return score


# ---------- Admin auth ----------
@app.post("/api/admin/auth")
def admin_auth(body: AdminAuthIn):
    if not verify_password(body.password):
        raise HTTPException(401, "invalid password")
    return {"token": make_admin_token()}


@app.post("/api/admin/test-sheets-backup")
def admin_test_sheets(_=Depends(require_admin)):
    """Round-trip a probe row to the configured Sheet to verify the credentials.

    Use after configuring GOOGLE_SHEETS_CREDENTIALS_JSON / SHEET_ID / SHEET_TAB_NAME.
    """
    return sheets_backup.send_test()


def _all_score_rows_for_sync() -> list[dict]:
    """Every score in the DB, joined with project metadata, in a shape
    `sheets_backup.sync_all` understands. Used by the manual sync button.
    """
    rows = get_conn().execute(
        """
        SELECT s.judge_id,
               s.project_id,
               p.title AS project_title,
               p.team_name,
               s.innovation, s.technical, s.impact, s.presentation,
               s.total_weighted, s.notes, s.updated_at
        FROM scores s
        JOIN projects p ON p.id = s.project_id
        ORDER BY s.updated_at
        """
    ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/admin/sync-sheets")
def admin_sync_sheets(_=Depends(require_admin)):
    """Re-export every score in the DB to the configured Sheet (idempotent).

    On success, also flips any matching pending_sync rows to 'submitted' so
    the Backup page's pending count goes to zero.
    """
    rows = _all_score_rows_for_sync()
    result = sheets_backup.sync_all(rows)
    if result.get("ok"):
        with tx() as c:
            c.execute("UPDATE scores SET sync_status = 'submitted' WHERE sync_status = 'pending_sync'")
    return {"total": len(rows), **result}


@app.get("/api/admin/backup-status")
def admin_backup_status(_=Depends(require_admin)):
    """Snapshot for the admin Backup tab: live link, last-sync, pending count."""
    pending_row = get_conn().execute(
        "SELECT COUNT(*) AS n FROM scores WHERE sync_status = 'pending_sync'"
    ).fetchone()
    pending = pending_row["n"] if isinstance(pending_row, dict) else pending_row[0]
    total_row = get_conn().execute("SELECT COUNT(*) AS n FROM scores").fetchone()
    total = total_row["n"] if isinstance(total_row, dict) else total_row[0]
    return {
        **sheets_backup.last_status(),
        "pending_count": pending,
        "total_scores": total,
    }


@app.post("/api/admin/sync-pending")
def admin_sync_pending(_=Depends(require_admin)):
    """Run one immediate pass over pending_sync rows (admin "Retry now")."""
    return _retry_pending_once()


# ---------- Admin: events ----------
@app.get("/api/admin/events")
def admin_events(_=Depends(require_admin)):
    conn = get_conn()
    rows = conn.execute("SELECT * FROM events ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


@app.post("/api/admin/events", response_model=EventOut)
def admin_create_event(body: EventIn, _=Depends(require_admin)):
    with tx() as c:
        eid = insert_returning_id(
            c,
            """INSERT INTO events (name, date, venue, city, org_name, org_address, org_website,
                                   organizer_name, organizer_title, logo_path, devpost_url, hours_expected)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (body.name, body.date, body.venue, body.city, body.org_name, body.org_address,
             body.org_website, body.organizer_name, body.organizer_title, body.logo_path,
             body.devpost_url, body.hours_expected),
        )
    row = get_conn().execute("SELECT * FROM events WHERE id = ?", (eid,)).fetchone()
    return dict(row)


@app.patch("/api/admin/events/{event_id}")
def admin_update_event(event_id: int, body: EventIn, _=Depends(require_admin)):
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(400, "nothing to update")
    keys = ", ".join(f"{k} = ?" for k in fields)
    with tx() as c:
        c.execute(f"UPDATE events SET {keys} WHERE id = ?", (*fields.values(), event_id))
    row = get_conn().execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
    if not row:
        raise HTTPException(404, "event not found")
    return dict(row)


@app.delete("/api/admin/events/{event_id}")
def admin_delete_event(event_id: int, _=Depends(require_admin)):
    with tx() as c:
        c.execute("DELETE FROM events WHERE id = ?", (event_id,))
    return {"ok": True}


# ---------- Admin: projects ----------
@app.get("/api/admin/projects")
def admin_list_projects(event_id: int, _=Depends(require_admin)):
    rows = get_conn().execute(
        "SELECT * FROM projects WHERE event_id = ? ORDER BY CAST(table_number AS INTEGER), title",
        (event_id,),
    ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/admin/projects")
def admin_create_project(body: ProjectIn, _=Depends(require_admin)):
    with tx() as c:
        pid = insert_returning_id(
            c,
            """INSERT INTO projects (event_id, title, team_name, table_number, track, description, devpost_url)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (body.event_id, body.title, body.team_name, body.table_number, body.track,
             body.description, body.devpost_url),
        )
    row = get_conn().execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
    return dict(row)


@app.patch("/api/admin/projects/{project_id}")
def admin_update_project(project_id: int, body: ProjectIn, _=Depends(require_admin)):
    fields = body.model_dump(exclude_unset=True)
    fields.pop("event_id", None)
    if not fields:
        raise HTTPException(400, "nothing to update")
    keys = ", ".join(f"{k} = ?" for k in fields)
    with tx() as c:
        c.execute(f"UPDATE projects SET {keys} WHERE id = ?", (*fields.values(), project_id))
    row = get_conn().execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if not row:
        raise HTTPException(404, "project not found")
    return dict(row)


@app.delete("/api/admin/projects/{project_id}")
def admin_delete_project(project_id: int, _=Depends(require_admin)):
    with tx() as c:
        c.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    return {"ok": True}


@app.post("/api/admin/projects/import")
def admin_import_projects(body: ProjectsImportIn, _=Depends(require_admin)):
    inserted = 0
    with tx() as c:
        for p in body.projects:
            c.execute(
                """INSERT INTO projects (event_id, title, team_name, table_number, track, description, devpost_url)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (body.event_id, p.title, p.team_name, p.table_number, p.track, p.description, p.devpost_url),
            )
            inserted += 1
    return {"inserted": inserted}


@app.post("/api/admin/projects/scrape")
async def admin_scrape(body: ScrapeIn, _=Depends(require_admin)):
    """Streams NDJSON progress events; persists projects as they are scraped."""

    async def gen():
        conn = get_conn()
        try:
            async for ev in scrape_event(body.devpost_url, limit=500):
                if ev.get("event") == "project":
                    try:
                        with tx() as c:
                            c.execute(
                                """INSERT INTO projects (event_id, title, team_name, description, devpost_url)
                                   VALUES (?, ?, ?, ?, ?)""",
                                (
                                    body.event_id,
                                    ev.get("title") or "Untitled",
                                    ev.get("team_name"),
                                    ev.get("description"),
                                    ev.get("devpost_url"),
                                ),
                            )
                    except Exception as e:
                        ev = {**ev, "error": str(e)}
                yield (json.dumps(ev) + "\n").encode()
        except Exception as e:
            yield (json.dumps({"event": "error", "message": str(e)}) + "\n").encode()

    return StreamingResponse(gen(), media_type="application/x-ndjson")


# ---------- Admin: judges ----------
@app.get("/api/admin/judges")
def admin_list_judges(event_id: int, _=Depends(require_admin)):
    rows = get_conn().execute(
        "SELECT * FROM judges WHERE event_id = ? ORDER BY name", (event_id,)
    ).fetchall()
    return [dict(r) for r in rows]


def _coerce_pin(supplied: Optional[str], used: set[str]) -> str:
    """Validate or allocate a PIN.

    - Empty/missing input → generate a unique random 6-digit PIN.
    - Supplied input → must normalize to exactly 6 digits and be unique;
      otherwise we fall back to a fresh random PIN. Names never become PINs.
    """
    norm = normalize_pin(supplied or "")
    if is_valid_pin(norm) and norm not in used:
        used.add(norm)
        return norm
    return generate_pin(used)


@app.post("/api/admin/judges")
def admin_create_judge(body: JudgeIn, _=Depends(require_admin)):
    used = {r["pin"] for r in get_conn().execute("SELECT pin FROM judges").fetchall() if r["pin"]}
    pin = _coerce_pin(body.pin, used)
    with tx() as c:
        jid = insert_returning_id(
            c,
            "INSERT INTO judges (event_id, name, email, expertise, pin) VALUES (?, ?, ?, ?, ?)",
            (body.event_id, body.name, body.email, body.expertise, pin),
        )
    row = get_conn().execute("SELECT * FROM judges WHERE id = ?", (jid,)).fetchone()
    return dict(row)


@app.patch("/api/admin/judges/{judge_id}")
def admin_update_judge(judge_id: int, body: JudgeIn, _=Depends(require_admin)):
    fields = body.model_dump(exclude_unset=True)
    fields.pop("event_id", None)
    if not fields:
        raise HTTPException(400, "nothing to update")
    if "pin" in fields:
        # Empty pin → reset; non-empty must be valid 6-digit numeric and unique.
        used = {r["pin"] for r in get_conn().execute(
            "SELECT pin FROM judges WHERE id <> ?", (judge_id,)
        ).fetchall() if r["pin"]}
        fields["pin"] = _coerce_pin(fields["pin"], used)
    keys = ", ".join(f"{k} = ?" for k in fields)
    with tx() as c:
        c.execute(f"UPDATE judges SET {keys} WHERE id = ?", (*fields.values(), judge_id))
    row = get_conn().execute("SELECT * FROM judges WHERE id = ?", (judge_id,)).fetchone()
    if not row:
        raise HTTPException(404, "judge not found")
    return dict(row)


@app.delete("/api/admin/judges/{judge_id}")
def admin_delete_judge(judge_id: int, _=Depends(require_admin)):
    with tx() as c:
        c.execute("DELETE FROM judges WHERE id = ?", (judge_id,))
    return {"ok": True}


@app.post("/api/admin/judges/import")
def admin_import_judges(body: JudgesImportIn, _=Depends(require_admin)):
    inserted = 0
    used = {r["pin"] for r in get_conn().execute("SELECT pin FROM judges").fetchall() if r["pin"]}
    with tx() as c:
        for j in body.judges:
            pin = _coerce_pin(j.pin, used)
            c.execute(
                "INSERT INTO judges (event_id, name, email, expertise, pin) VALUES (?, ?, ?, ?, ?)",
                (body.event_id, j.name, j.email, j.expertise, pin),
            )
            inserted += 1
    return {"inserted": inserted}


def _qr_png(judge_id: int, event_id: int) -> bytes:
    token = make_judge_token(judge_id, event_id)
    url = f"{FRONTEND_BASE_URL}/judge?token={token}"
    img = qrcode.make(url, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@app.get("/api/admin/judges/{judge_id}/qr")
def admin_qr(judge_id: int, _=Depends(require_admin_q)):
    row = get_conn().execute("SELECT * FROM judges WHERE id = ?", (judge_id,)).fetchone()
    if not row:
        raise HTTPException(404, "judge not found")
    png = _qr_png(judge_id, row["event_id"])
    return Response(content=png, media_type="image/png",
                    headers={"Content-Disposition": f'inline; filename="qr_{row["name"]}.png"'})


@app.get("/api/admin/qr/zip")
def admin_qr_zip(event_id: int, _=Depends(require_admin_q)):
    rows = get_conn().execute("SELECT * FROM judges WHERE event_id = ?", (event_id,)).fetchall()
    if not rows:
        raise HTTPException(404, "no judges for this event")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for j in rows:
            png = _qr_png(j["id"], event_id)
            safe = "".join(c for c in (j["name"] or "judge") if c.isalnum() or c in "-_") or f"judge_{j['id']}"
            zf.writestr(f"qr_{safe}_{j['id']}.png", png)
    buf.seek(0)
    return Response(content=buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="qr_codes_event_{event_id}.zip"'})


# ---------- Admin: leaderboard / exports ----------
def _leaderboard_rows(event_id: int) -> list[dict]:
    rows = get_conn().execute(
        """
        SELECT p.id, p.title, p.team_name, p.table_number, p.track,
               COALESCE(AVG(s.total_weighted), 0) AS avg_score,
               COUNT(DISTINCT s.judge_id) AS judge_count,
               COALESCE(MIN(s.total_weighted), 0) AS min_score,
               COALESCE(MAX(s.total_weighted), 0) AS max_score
        FROM projects p
        LEFT JOIN scores s ON s.project_id = p.id
        WHERE p.event_id = ?
        GROUP BY p.id
        ORDER BY avg_score DESC, p.title
        """,
        (event_id,),
    ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/admin/leaderboard")
def admin_leaderboard(event_id: int, _=Depends(require_admin)):
    return _leaderboard_rows(event_id)


@app.get("/api/admin/scores")
def admin_scores(event_id: int, _=Depends(require_admin)):
    """Every score for this event, joined with judge + project for visibility."""
    rows = get_conn().execute(
        """
        SELECT s.id, s.judge_id, j.name AS judge_name,
               s.project_id, p.title AS project_title, p.team_name, p.table_number,
               s.innovation, s.technical, s.impact, s.presentation,
               s.total_raw, s.total_weighted, s.notes, s.updated_at
        FROM scores s
        JOIN judges j ON j.id = s.judge_id
        JOIN projects p ON p.id = s.project_id
        WHERE p.event_id = ?
        ORDER BY s.updated_at DESC
        """,
        (event_id,),
    ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/admin/export/scores")
def admin_export_scores(event_id: int, _=Depends(require_admin_q)):
    rows = get_conn().execute(
        """
        SELECT j.name AS judge_name, p.title AS project_title, p.team_name, p.table_number,
               s.innovation, s.technical, s.impact, s.presentation,
               s.total_raw, s.total_weighted, s.notes, s.updated_at
        FROM scores s
        JOIN judges j ON j.id = s.judge_id
        JOIN projects p ON p.id = s.project_id
        WHERE p.event_id = ?
        ORDER BY p.title, j.name
        """,
        (event_id,),
    ).fetchall()
    out = io.StringIO()
    w = csv.writer(out)
    if rows:
        w.writerow(rows[0].keys())
        for r in rows:
            w.writerow([r[k] for k in r.keys()])
    else:
        w.writerow(["judge_name", "project_title", "team_name", "table_number",
                    "innovation", "technical", "impact", "presentation",
                    "total_raw", "total_weighted", "notes", "updated_at"])
    return Response(content=out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="scores_event_{event_id}.csv"'})


@app.get("/api/admin/export/leaderboard")
def admin_export_leaderboard_csv(event_id: int, _=Depends(require_admin_q)):
    rows = _leaderboard_rows(event_id)
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["rank", "title", "team_name", "table_number", "track", "avg_score", "judge_count"])
    for i, r in enumerate(rows, 1):
        w.writerow([i, r["title"], r["team_name"], r["table_number"], r["track"],
                    round(r["avg_score"], 3), r["judge_count"]])
    return Response(content=out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="leaderboard_event_{event_id}.csv"'})


@app.get("/api/admin/export/luma")
def admin_export_luma(event_id: int, top: int = Query(10, ge=1, le=100), _=Depends(require_admin_q)):
    rows = _leaderboard_rows(event_id)[:top]
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["name", "email", "team", "rank"])
    for i, r in enumerate(rows, 1):
        w.writerow([r["title"], "", r["team_name"], i])
    return Response(content=out.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="luma_top{top}_event_{event_id}.csv"'})


# ---------- Static frontend (production build) ----------
DIST = Path(__file__).parent.parent / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(404, "not found")
        index = DIST / "index.html"
        if index.exists():
            return Response(content=index.read_bytes(), media_type="text/html")
        raise HTTPException(404, "frontend not built")
