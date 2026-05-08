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
from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.responses import Response, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from database import get_conn, init_db, start_backup_scheduler, stop_backup_scheduler, tx
from models import (
    EventIn, EventOut, JudgeIn, ProjectIn, ScoreIn,
    PinAuthIn, AdminAuthIn, ProjectsImportIn, JudgesImportIn, ScrapeIn,
)
from auth import (
    make_judge_token, make_admin_token, hash_token,
    verify_password, verify_pin, require_judge, require_admin, require_admin_q,
)
from scrape_devpost import scrape_event

WEIGHTS = {"innovation": 0.25, "technical": 0.25, "impact": 0.25, "presentation": 0.25}
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    start_backup_scheduler()
    yield
    stop_backup_scheduler()


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
    return {"ok": True}


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


@app.post("/api/judge/auth/pin")
def judge_auth_pin(body: PinAuthIn):
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
        "SELECT * FROM projects WHERE event_id = ? ORDER BY CAST(table_number AS INTEGER), title",
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


@app.post("/api/judge/scores")
def judge_post_score(body: ScoreIn, judge=Depends(require_judge)):
    conn = get_conn()
    project = conn.execute(
        "SELECT * FROM projects WHERE id = ? AND event_id = ?", (body.project_id, judge["event_id"])
    ).fetchone()
    if not project:
        raise HTTPException(404, "project not in this event")
    raw, weighted = _compute_totals(body)
    with tx() as c:
        c.execute(
            """
            INSERT INTO scores (judge_id, project_id, innovation, technical, impact, presentation,
                                total_raw, total_weighted, notes, sync_status, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', datetime('now'))
            ON CONFLICT(judge_id, project_id) DO UPDATE SET
              innovation = excluded.innovation,
              technical  = excluded.technical,
              impact     = excluded.impact,
              presentation = excluded.presentation,
              total_raw  = excluded.total_raw,
              total_weighted = excluded.total_weighted,
              notes      = excluded.notes,
              updated_at = datetime('now'),
              sync_status = 'synced'
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
    return dict(row)


# ---------- Admin auth ----------
@app.post("/api/admin/auth")
def admin_auth(body: AdminAuthIn):
    if not verify_password(body.password):
        raise HTTPException(401, "invalid password")
    return {"token": make_admin_token()}


# ---------- Admin: events ----------
@app.get("/api/admin/events")
def admin_events(_=Depends(require_admin)):
    conn = get_conn()
    rows = conn.execute("SELECT * FROM events ORDER BY created_at DESC").fetchall()
    return [dict(r) for r in rows]


@app.post("/api/admin/events", response_model=EventOut)
def admin_create_event(body: EventIn, _=Depends(require_admin)):
    conn = get_conn()
    with tx() as c:
        cur = c.execute(
            """INSERT INTO events (name, date, venue, city, org_name, org_address, org_website,
                                   organizer_name, organizer_title, logo_path, hours_expected)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (body.name, body.date, body.venue, body.city, body.org_name, body.org_address,
             body.org_website, body.organizer_name, body.organizer_title, body.logo_path,
             body.hours_expected),
        )
        eid = cur.lastrowid
    row = conn.execute("SELECT * FROM events WHERE id = ?", (eid,)).fetchone()
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
        cur = c.execute(
            """INSERT INTO projects (event_id, title, team_name, table_number, track, description, devpost_url)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (body.event_id, body.title, body.team_name, body.table_number, body.track,
             body.description, body.devpost_url),
        )
        pid = cur.lastrowid
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


def _gen_pin() -> str:
    import secrets
    return f"{secrets.randbelow(1_000_000):06d}"


@app.post("/api/admin/judges")
def admin_create_judge(body: JudgeIn, _=Depends(require_admin)):
    pin = body.pin or _gen_pin()
    with tx() as c:
        cur = c.execute(
            "INSERT INTO judges (event_id, name, email, expertise, pin) VALUES (?, ?, ?, ?, ?)",
            (body.event_id, body.name, body.email, body.expertise, pin),
        )
        jid = cur.lastrowid
    row = get_conn().execute("SELECT * FROM judges WHERE id = ?", (jid,)).fetchone()
    return dict(row)


@app.patch("/api/admin/judges/{judge_id}")
def admin_update_judge(judge_id: int, body: JudgeIn, _=Depends(require_admin)):
    fields = body.model_dump(exclude_unset=True)
    fields.pop("event_id", None)
    if not fields:
        raise HTTPException(400, "nothing to update")
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
    with tx() as c:
        for j in body.judges:
            c.execute(
                "INSERT INTO judges (event_id, name, email, expertise, pin) VALUES (?, ?, ?, ?, ?)",
                (body.event_id, j.name, j.email, j.expertise, j.pin or _gen_pin()),
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
