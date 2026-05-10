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

    calls: dict[str, list] = {"mirror_score": [], "sync_all": []}
    monkeypatch.setattr(
        sheets_backup, "mirror_score",
        lambda s, j, p: calls["mirror_score"].append((s, j, p)),
    )
    monkeypatch.setattr(
        sheets_backup, "sync_all",
        lambda rows: (calls["sync_all"].append(list(rows)) or {"ok": True, "appended": len(calls["sync_all"][-1]), "updated": 0, "rows": len(calls["sync_all"][-1])}),
    )
    monkeypatch.setattr(sheets_backup, "is_configured", lambda: True)

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


def test_score_submit_invokes_sheets_mirror(app_with_seed):
    client, calls, database = app_with_seed
    jid, pin = _judge_pin(database)
    jt = _judge_token(client, pin)
    event_id = database.get_conn().execute(
        "SELECT event_id FROM judges WHERE id = ?", (jid,),
    ).fetchone()["event_id"]
    # Insert a project to score.
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
    assert calls["mirror_score"], "expected sheets_backup.mirror_score to be called"
    score, judge, project = calls["mirror_score"][-1]
    assert judge["id"] == jid
    assert project["id"] == pid
    assert score["total_weighted"] == pytest.approx(7.5)


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
