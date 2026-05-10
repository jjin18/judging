"""Auth + Sheets-backup tests.

Covers:
  - judge PIN auth accepts only 6-digit codes; names never log in
  - admin password rejects judge PINs
  - judge token is rejected by admin routes
  - admin token is rejected by judge routes
  - score submit calls into sheets_backup.mirror_score (mocked)
  - manual sync route calls sheets_backup.sync_all with all rows (mocked)
"""
from __future__ import annotations

import importlib
import os
import sys
import tempfile
from pathlib import Path

import pytest


@pytest.fixture()
def app_with_seed(monkeypatch, tmp_path):
    """Fresh DB, fresh module imports, fresh seed. Sheets calls are mocked."""
    db_path = tmp_path / "test.db"
    monkeypatch.setenv("DB_PATH", str(db_path))
    monkeypatch.setenv("ADMIN_PASSWORD", "s3cret-admin-pass")
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("GOOGLE_SHEETS_CREDENTIALS_JSON", raising=False)
    monkeypatch.delenv("SHEET_ID", raising=False)

    sys.path.insert(0, str(Path(__file__).parent))
    for mod in ("auth", "database", "models", "seed", "sheets_backup", "main"):
        sys.modules.pop(mod, None)

    import database  # noqa: E402
    importlib.reload(database)
    import auth  # noqa: E402
    importlib.reload(auth)
    import sheets_backup  # noqa: E402
    importlib.reload(sheets_backup)

    calls: dict = {"mirror_score": [], "mirror_score_sync": [], "sync_all": [], "sheets_succeeds": True}
    monkeypatch.setattr(
        sheets_backup, "mirror_score",
        lambda s, j, p: calls["mirror_score"].append((s, j, p)),
    )

    def _fake_sync(s, j, p):
        calls["mirror_score_sync"].append((s, j, p))
        return calls["sheets_succeeds"]
    monkeypatch.setattr(sheets_backup, "mirror_score_sync", _fake_sync)
    monkeypatch.setattr(
        sheets_backup, "sync_all",
        lambda rows: (calls["sync_all"].append(list(rows)) or {"ok": True, "appended": len(calls["sync_all"][-1]), "updated": 0, "rows": len(calls["sync_all"][-1])}),
    )
    monkeypatch.setattr(sheets_backup, "is_configured", lambda: True)
    monkeypatch.setattr(sheets_backup, "last_status", lambda: {
        "configured": True, "tab": "scores", "sheet_url": "https://docs.google.com/spreadsheets/d/fake",
        "last_success_ts": None, "last_error": None,
    })

    import main  # noqa: E402
    importlib.reload(main)

    # Run the seed against the fresh DB; manually so we don't trigger lifespan.
    database.init_db()
    from seed import seed as run_seed  # noqa: E402
    run_seed(wipe=True)

    from fastapi.testclient import TestClient  # noqa: E402

    client = TestClient(main.app)
    yield client, calls, database


def _judge_pin(database) -> tuple[int, str]:
    row = database.get_conn().execute("SELECT id, pin FROM judges LIMIT 1").fetchone()
    return int(row["id"]), str(row["pin"])


def _judge_token(client, pin: str) -> str:
    r = client.post("/api/judge/auth/pin", json={"pin": pin})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _admin_token(client, password: str = "s3cret-admin-pass") -> str:
    r = client.post("/api/admin/auth", json={"password": password})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def test_seed_pins_are_six_digit_numeric(app_with_seed):
    client, _calls, database = app_with_seed
    rows = database.get_conn().execute("SELECT pin, name FROM judges").fetchall()
    assert len(rows) > 0
    for r in rows:
        pin = r["pin"]
        assert pin.isdigit() and len(pin) == 6, f"bad pin {pin!r} for {r['name']}"
    pins = [r["pin"] for r in rows]
    assert len(set(pins)) == len(pins), "PINs must be unique"


def test_judge_login_with_pin(app_with_seed):
    client, _calls, database = app_with_seed
    _, pin = _judge_pin(database)
    r = client.post("/api/judge/auth/pin", json={"pin": pin})
    assert r.status_code == 200
    assert "token" in r.json()


def test_judge_login_rejects_name(app_with_seed):
    client, _calls, database = app_with_seed
    row = database.get_conn().execute("SELECT name FROM judges LIMIT 1").fetchone()
    name = row["name"]
    # Plain name and several normalized forms must all fail.
    for guess in [name, name.lower(), name.replace(" ", ""), name.replace(" ", "").lower()]:
        r = client.post("/api/judge/auth/pin", json={"pin": guess})
        assert r.status_code == 401, f"name {guess!r} unexpectedly authenticated"


def test_admin_password_separate_from_judge_pin(app_with_seed):
    client, _calls, database = app_with_seed
    _, pin = _judge_pin(database)
    # A judge PIN must not authenticate against admin.
    r = client.post("/api/admin/auth", json={"password": pin})
    assert r.status_code == 401

    # And the actual admin password works.
    r = client.post("/api/admin/auth", json={"password": "s3cret-admin-pass"})
    assert r.status_code == 200


def test_judge_token_rejected_on_admin_route(app_with_seed):
    client, _calls, database = app_with_seed
    _, pin = _judge_pin(database)
    jt = _judge_token(client, pin)
    r = client.get("/api/admin/events", headers={"Authorization": f"Bearer {jt}"})
    assert r.status_code == 403


def test_admin_token_rejected_on_judge_route(app_with_seed):
    client, _calls, database = app_with_seed
    at = _admin_token(client)
    r = client.get("/api/judge/projects", headers={"Authorization": f"Bearer {at}"})
    assert r.status_code == 403


def _spin_app_with_admin_env(monkeypatch, tmp_path, admin_env_value):
    """Reload modules with the requested ADMIN_PASSWORD env state, return TestClient.

    `admin_env_value` is the literal env value, or None to delete the var.
    """
    db_path = tmp_path / "adminenv.db"
    monkeypatch.setenv("DB_PATH", str(db_path))
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    if admin_env_value is None:
        monkeypatch.delenv("ADMIN_PASSWORD", raising=False)
    else:
        monkeypatch.setenv("ADMIN_PASSWORD", admin_env_value)

    sys.path.insert(0, str(Path(__file__).parent))
    for mod in ("auth", "database", "seed", "sheets_backup", "main"):
        sys.modules.pop(mod, None)
    import database  # noqa: E402
    importlib.reload(database)
    import auth  # noqa: E402
    importlib.reload(auth)
    import sheets_backup  # noqa: E402
    importlib.reload(sheets_backup)
    monkeypatch.setattr(sheets_backup, "is_configured", lambda: False)
    import main  # noqa: E402
    importlib.reload(main)
    database.init_db()
    from fastapi.testclient import TestClient  # noqa: E402
    return TestClient(main.app), database


def test_admin_login_uses_default_when_env_unset(monkeypatch, tmp_path):
    """ADMIN_PASSWORD env var unset → falls back to PhysicalAIHacks2026!."""
    client, _ = _spin_app_with_admin_env(monkeypatch, tmp_path, admin_env_value=None)
    r = client.post("/api/admin/auth", json={"password": "PhysicalAIHacks2026!"})
    assert r.status_code == 200, r.text
    assert "token" in r.json()
    # Wrong password still fails.
    assert client.post("/api/admin/auth", json={"password": "wrong"}).status_code == 401


def test_admin_login_uses_default_when_env_blank(monkeypatch, tmp_path):
    """ADMIN_PASSWORD set to empty string must also fall back to default —
    otherwise ops who clear the var on Railway lock themselves out."""
    client, _ = _spin_app_with_admin_env(monkeypatch, tmp_path, admin_env_value="")
    r = client.post("/api/admin/auth", json={"password": "PhysicalAIHacks2026!"})
    assert r.status_code == 200, r.text


def test_admin_login_strips_whitespace(monkeypatch, tmp_path):
    """Trailing newline/whitespace from a copy-paste env value must not lock out."""
    client, _ = _spin_app_with_admin_env(monkeypatch, tmp_path, admin_env_value="  PhysicalAIHacks2026!  \n")
    r = client.post("/api/admin/auth", json={"password": "PhysicalAIHacks2026!"})
    assert r.status_code == 200, r.text
    # Whitespace on the submitted side is also tolerated.
    r = client.post("/api/admin/auth", json={"password": " PhysicalAIHacks2026! "})
    assert r.status_code == 200, r.text


def test_admin_password_collision_with_judge_pin_is_rejected(monkeypatch, tmp_path):
    """If ADMIN_PASSWORD is accidentally set to a value that equals a judge PIN,
    `/api/admin/auth` must still fail."""
    db_path = tmp_path / "collision.db"
    monkeypatch.setenv("DB_PATH", str(db_path))
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.delenv("DATABASE_URL", raising=False)

    sys.path.insert(0, str(Path(__file__).parent))
    for mod in ("auth", "database", "seed", "sheets_backup", "main"):
        sys.modules.pop(mod, None)
    import database  # noqa: E402
    importlib.reload(database)

    database.init_db()
    # Create a judge with PIN 123456 directly, then set ADMIN_PASSWORD to match.
    with database.tx() as c:
        eid = database.insert_returning_id(
            c, "INSERT INTO events (name) VALUES (?)", ("CollideEvt",),
        )
        c.execute(
            "INSERT INTO judges (event_id, name, pin) VALUES (?, ?, ?)",
            (eid, "Test Judge", "123456"),
        )

    monkeypatch.setenv("ADMIN_PASSWORD", "123456")
    sys.modules.pop("auth", None)
    sys.modules.pop("main", None)
    import auth  # noqa: E402
    importlib.reload(auth)
    import main  # noqa: E402
    importlib.reload(main)
    from fastapi.testclient import TestClient
    client = TestClient(main.app)

    # Even though ADMIN_PASSWORD == PIN, admin auth must refuse — collision
    # detection in verify_password.
    r = client.post("/api/admin/auth", json={"password": "123456"})
    assert r.status_code == 401


def test_score_submit_calls_sync_mirror_and_marks_submitted(app_with_seed):
    """Happy path: DB write + Sheets sync both succeed → row is 'submitted'."""
    client, calls, database = app_with_seed
    jid, pin = _judge_pin(database)
    jt = _judge_token(client, pin)
    event_id = database.get_conn().execute(
        "SELECT event_id FROM judges WHERE id = ?", (jid,),
    ).fetchone()["event_id"]
    with database.tx() as c:
        pid = database.insert_returning_id(
            c, "INSERT INTO projects (event_id, title) VALUES (?, ?)",
            (event_id, "Test Project"),
        )
    body = {
        "project_id": pid,
        "innovation": 7, "technical": 8, "impact": 6, "presentation": 9,
        "notes": "looks great",
    }
    r = client.post("/api/judge/scores", json=body,
                    headers={"Authorization": f"Bearer {jt}"})
    assert r.status_code == 200
    assert calls["mirror_score_sync"], "expected mirror_score_sync to be called"
    score, judge, project = calls["mirror_score_sync"][-1]
    assert judge["id"] == jid
    assert project["id"] == pid
    assert score["total_weighted"] == pytest.approx(7.5)
    assert r.json()["sync_status"] == "submitted"
    # And the DB persists that status.
    row = database.get_conn().execute(
        "SELECT sync_status FROM scores WHERE judge_id = ? AND project_id = ?",
        (jid, pid),
    ).fetchone()
    assert row["sync_status"] == "submitted"


def test_score_submit_when_sheets_fails_keeps_row_pending(app_with_seed):
    """If Sheets returns False, the DB row is saved but stays 'pending_sync'."""
    client, calls, database = app_with_seed
    calls["sheets_succeeds"] = False
    jid, pin = _judge_pin(database)
    jt = _judge_token(client, pin)
    event_id = database.get_conn().execute(
        "SELECT event_id FROM judges WHERE id = ?", (jid,),
    ).fetchone()["event_id"]
    with database.tx() as c:
        pid = database.insert_returning_id(
            c, "INSERT INTO projects (event_id, title) VALUES (?, ?)",
            (event_id, "Sheets Down"),
        )
    r = client.post("/api/judge/scores",
                    headers={"Authorization": f"Bearer {jt}"},
                    json={"project_id": pid, "innovation": 5, "technical": 5,
                          "impact": 5, "presentation": 5})
    assert r.status_code == 200
    assert r.json()["sync_status"] == "pending_sync"
    row = database.get_conn().execute(
        "SELECT sync_status FROM scores WHERE judge_id = ? AND project_id = ?",
        (jid, pid),
    ).fetchone()
    assert row["sync_status"] == "pending_sync"

    # Now Sheets recovers; admin clicks "Retry now" → row flips to submitted.
    calls["sheets_succeeds"] = True
    at = _admin_token(client)
    r = client.post("/api/admin/sync-pending", headers={"Authorization": f"Bearer {at}"})
    assert r.status_code == 200
    assert r.json()["succeeded"] >= 1
    row = database.get_conn().execute(
        "SELECT sync_status FROM scores WHERE judge_id = ? AND project_id = ?",
        (jid, pid),
    ).fetchone()
    assert row["sync_status"] == "submitted"


def test_pin_rate_limit_per_ip(app_with_seed):
    """11th wrong-PIN attempt within 60s from the same IP gets a 429."""
    client, _calls, database = app_with_seed
    # Reset the rate-limit bucket so prior tests don't poison this one.
    import main as _main
    _main._PIN_ATTEMPTS.clear()
    last = None
    for _ in range(10):
        last = client.post("/api/judge/auth/pin", json={"pin": "000000"})
        assert last.status_code in (401, 429)
    assert last.status_code == 401  # 10 attempts allowed
    blocked = client.post("/api/judge/auth/pin", json={"pin": "000000"})
    assert blocked.status_code == 429


def test_admin_backup_status(app_with_seed):
    """Backup-status endpoint returns the live Sheet link and pending count."""
    client, _calls, database = app_with_seed
    at = _admin_token(client)
    r = client.get("/api/admin/backup-status", headers={"Authorization": f"Bearer {at}"})
    assert r.status_code == 200
    body = r.json()
    assert body["configured"] is True
    assert body["sheet_url"] == "https://docs.google.com/spreadsheets/d/fake"
    assert "pending_count" in body
    assert "total_scores" in body


def test_score_resubmit_upserts_in_place(app_with_seed):
    """Two submissions for the same (judge, project) → one row, latest values win."""
    client, calls, database = app_with_seed
    jid, pin = _judge_pin(database)
    jt = _judge_token(client, pin)
    event_id = database.get_conn().execute(
        "SELECT event_id FROM judges WHERE id = ?", (jid,),
    ).fetchone()["event_id"]
    with database.tx() as c:
        pid = database.insert_returning_id(
            c, "INSERT INTO projects (event_id, title) VALUES (?, ?)",
            (event_id, "Same Project"),
        )
    headers = {"Authorization": f"Bearer {jt}"}
    client.post("/api/judge/scores", headers=headers, json={
        "project_id": pid, "innovation": 1, "technical": 1, "impact": 1, "presentation": 1,
        "notes": "first",
    })
    client.post("/api/judge/scores", headers=headers, json={
        "project_id": pid, "innovation": 9, "technical": 9, "impact": 9, "presentation": 9,
        "notes": "updated",
    })
    rows = database.get_conn().execute(
        "SELECT innovation, notes FROM scores WHERE judge_id = ? AND project_id = ?",
        (jid, pid),
    ).fetchall()
    assert len(rows) == 1, "expected exactly one row per (judge, project)"
    assert rows[0]["innovation"] == 9
    assert rows[0]["notes"] == "updated"


def test_leaderboard_average_uses_distinct_judges(app_with_seed):
    """Leaderboard average is over distinct (judge, project) pairs only."""
    client, calls, database = app_with_seed
    # Two judges, one project. Each judge submits once → average is over both.
    rows = database.get_conn().execute("SELECT id, pin, event_id FROM judges LIMIT 2").fetchall()
    assert len(rows) >= 2
    j1, j2 = rows[0], rows[1]
    event_id = j1["event_id"]
    with database.tx() as c:
        pid = database.insert_returning_id(
            c, "INSERT INTO projects (event_id, title) VALUES (?, ?)",
            (event_id, "Avg Test"),
        )
    for j, score in [(j1, 4), (j2, 8)]:
        t = _judge_token(client, j["pin"])
        client.post("/api/judge/scores",
                    headers={"Authorization": f"Bearer {t}"},
                    json={"project_id": pid, "innovation": score, "technical": score,
                          "impact": score, "presentation": score})
    at = _admin_token(client)
    r = client.get(f"/api/admin/leaderboard?event_id={event_id}",
                   headers={"Authorization": f"Bearer {at}"})
    assert r.status_code == 200
    proj = next(p for p in r.json() if p["id"] == pid)
    assert proj["judge_count"] == 2
    assert proj["avg_score"] == pytest.approx(6.0)  # (4 + 8) / 2


def test_manual_sync_calls_sheets_with_all_rows(app_with_seed):
    client, calls, database = app_with_seed
    jid, pin = _judge_pin(database)
    jt = _judge_token(client, pin)
    event_id = database.get_conn().execute(
        "SELECT event_id FROM judges WHERE id = ?", (jid,),
    ).fetchone()["event_id"]
    with database.tx() as c:
        pid = database.insert_returning_id(
            c, "INSERT INTO projects (event_id, title) VALUES (?, ?)",
            (event_id, "Test Project Two"),
        )
    client.post(
        "/api/judge/scores",
        headers={"Authorization": f"Bearer {jt}"},
        json={"project_id": pid, "innovation": 5, "technical": 5, "impact": 5, "presentation": 5},
    )
    at = _admin_token(client)
    r = client.post("/api/admin/sync-sheets", headers={"Authorization": f"Bearer {at}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["total"] == 1
    assert calls["sync_all"], "expected sheets_backup.sync_all to be called"
    rows = calls["sync_all"][-1]
    assert len(rows) == 1
    row = rows[0]
    assert row["judge_id"] == jid
    assert row["project_id"] == pid
    # judge_id is exposed; PIN is not part of the row payload.
    assert "pin" not in row
