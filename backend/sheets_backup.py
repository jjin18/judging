"""Mirror scores to a Google Sheet via service-account credentials.

Configured via three env vars:

    GOOGLE_SHEETS_CREDENTIALS_JSON   the service-account JSON key (raw JSON)
    SHEET_ID                         the spreadsheet's id (from its URL)
    SHEET_TAB_NAME                   the tab/worksheet to write to

The sheet must be shared with the service account's `client_email` (Editor).

Writes are best-effort: failures are logged but never block the user. Each
score row is keyed on (judge_id, project_id) so re-syncs are idempotent — a
re-emit overwrites the matching row instead of appending a duplicate.

Columns (in order):
    timestamp, judge_id, team_or_project, criterion_scores, total, comments
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Any, Iterable, Optional


HEADER = ["timestamp", "judge_id", "team_or_project", "criterion_scores", "total", "comments"]
_KEY_SEP = " | "  # not a digit, not in JSON output

_lock = threading.Lock()


def _env_creds_json() -> str:
    return os.environ.get("GOOGLE_SHEETS_CREDENTIALS_JSON", "").strip()


def _env_sheet_id() -> str:
    return os.environ.get("SHEET_ID", "").strip()


def _env_tab_name() -> str:
    return os.environ.get("SHEET_TAB_NAME", "").strip() or "scores"


def is_configured() -> bool:
    return bool(_env_creds_json() and _env_sheet_id())


def _build_service():
    """Build a Sheets API client. Raises on misconfiguration or missing deps."""
    creds_raw = _env_creds_json()
    if not creds_raw or not _env_sheet_id():
        raise RuntimeError("Sheets backup not configured")
    try:
        from google.oauth2.service_account import Credentials  # type: ignore
        from googleapiclient.discovery import build  # type: ignore
    except ImportError as e:
        raise RuntimeError(
            "google-api-python-client / google-auth not installed; "
            "add them to requirements.txt"
        ) from e
    info = json.loads(creds_raw)
    creds = Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def _format_row(score: dict, judge: dict, project: dict) -> tuple[str, list[Any]]:
    """Return (sheet_key, row) for a score+judge+project triple.

    The sheet_key — `judge_id | team_or_project` — is what we dedup on for
    upserts, matching the columns laid down in `HEADER`.
    """
    judge_id = judge.get("id")
    project_id = project.get("id")
    team_or_project = (
        project.get("team_name")
        or project.get("title")
        or f"project_{project_id}"
    )
    criterion = {
        "innovation": score.get("innovation"),
        "technical": score.get("technical"),
        "impact": score.get("impact"),
        "presentation": score.get("presentation"),
    }
    total = score.get("total_weighted")
    comments = score.get("notes") or ""
    timestamp = str(score.get("updated_at") or "")
    if not timestamp:
        timestamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    row = [
        timestamp,
        judge_id,
        team_or_project,
        json.dumps(criterion, separators=(",", ":")),
        total,
        comments,
    ]
    return f"{judge_id}{_KEY_SEP}{team_or_project}", row


def _ensure_tab_exists(svc, sheet_id: str, tab: str) -> None:
    """Create the worksheet tab if it doesn't already exist.

    A fresh spreadsheet only has "Sheet1"; if the operator set
    SHEET_TAB_NAME=scores we need to add that tab before any range read,
    otherwise the API 400s with "Unable to parse range".
    """
    meta = svc.spreadsheets().get(
        spreadsheetId=sheet_id, fields="sheets.properties.title",
    ).execute()
    titles = {s["properties"]["title"] for s in meta.get("sheets", [])}
    if tab in titles:
        return
    svc.spreadsheets().batchUpdate(
        spreadsheetId=sheet_id,
        body={"requests": [{"addSheet": {"properties": {"title": tab}}}]},
    ).execute()


def _ensure_header(svc, sheet_id: str, tab: str) -> None:
    """Lay down the header row if the tab is empty (idempotent)."""
    _ensure_tab_exists(svc, sheet_id, tab)
    rng = f"{tab}!A1:F1"
    res = svc.spreadsheets().values().get(spreadsheetId=sheet_id, range=rng).execute()
    values = res.get("values", [])
    if not values:
        svc.spreadsheets().values().update(
            spreadsheetId=sheet_id,
            range=rng,
            valueInputOption="RAW",
            body={"values": [HEADER]},
        ).execute()


def _all_keys(svc, sheet_id: str, tab: str) -> dict[str, int]:
    """Return {(judge_id|team_or_project): row_number} for existing data rows.

    Row numbers are 1-indexed; the header occupies row 1 so data starts at row 2.
    """
    res = svc.spreadsheets().values().get(
        spreadsheetId=sheet_id, range=f"{tab}!A2:F",
    ).execute()
    out: dict[str, int] = {}
    for i, row in enumerate(res.get("values", []) or [], start=2):
        if len(row) < 3:
            continue
        out[f"{row[1]}{_KEY_SEP}{row[2]}"] = i
    return out


def _upsert_rows(svc, sheet_id: str, tab: str, rows: list[tuple[str, list[Any]]]) -> dict:
    """Write rows, replacing any existing row with the same (judge_id, team_or_project)."""
    _ensure_header(svc, sheet_id, tab)
    existing = _all_keys(svc, sheet_id, tab)
    updates: list[dict] = []
    appends: list[list[Any]] = []
    seen_in_batch: set[str] = set()
    for key, row in rows:
        if key in existing:
            r = existing[key]
            updates.append({"range": f"{tab}!A{r}:F{r}", "values": [row]})
        elif key in seen_in_batch:
            # Same key twice in this batch (rare) — fold into the last append.
            for a in reversed(appends):
                if f"{a[1]}{_KEY_SEP}{a[2]}" == key:
                    a[:] = row
                    break
        else:
            appends.append(row)
            seen_in_batch.add(key)
    written = 0
    if updates:
        svc.spreadsheets().values().batchUpdate(
            spreadsheetId=sheet_id,
            body={"valueInputOption": "RAW", "data": updates},
        ).execute()
        written += len(updates)
    if appends:
        svc.spreadsheets().values().append(
            spreadsheetId=sheet_id,
            range=f"{tab}!A:F",
            valueInputOption="RAW",
            insertDataOption="INSERT_ROWS",
            body={"values": appends},
        ).execute()
        written += len(appends)
    return {"updated": len(updates), "appended": len(appends), "rows": written}


_last_success_ts: float | None = None
_last_error: str | None = None


def last_status() -> dict:
    """Snapshot of the most recent sync result, surfaced on the admin Backup page."""
    return {
        "configured": is_configured(),
        "tab": _env_tab_name() if is_configured() else None,
        "sheet_url": (
            f"https://docs.google.com/spreadsheets/d/{_env_sheet_id()}"
            if _env_sheet_id() else None
        ),
        "last_success_ts": _last_success_ts,
        "last_error": _last_error,
    }


def _do_mirror(score: dict, judge: dict, project: dict) -> bool:
    global _last_success_ts, _last_error
    if not is_configured():
        return False
    try:
        svc = _build_service()
        with _lock:
            _upsert_rows(
                svc, _env_sheet_id(), _env_tab_name(),
                [_format_row(score, judge, project)],
            )
        _last_success_ts = time.time()
        _last_error = None
        return True
    except Exception as e:
        _last_error = str(e)
        print(f"[sheets] mirror failed: {e}")
        return False


def mirror_score_sync(score_row: dict, judge: dict, project: dict) -> bool:
    """Synchronous mirror — caller awaits the Sheets round-trip and gets a
    True/False back. Use this from request handlers that need to know whether
    the Sheet was updated before responding."""
    return _do_mirror(score_row, judge, project)


def mirror_score(score_row: dict, judge: dict, project: dict) -> None:
    """Fire-and-forget variant. Kept for compatibility with the team
    submission code path (which doesn't wait on Sheets) and for tests that
    monkeypatch this name."""
    threading.Thread(
        target=_do_mirror, args=(score_row, judge, project), daemon=True,
    ).start()


def mirror_submission(project_row: dict) -> None:
    """No-op for submissions — only scores go to the Sheet by spec.

    Kept as a stub so existing call sites don't need conditional imports.
    """
    return None


def sync_all(rows: Iterable[dict]) -> dict:
    """Re-export every score in the DB to the Sheet, idempotent.

    `rows` is an iterable of dicts with at least the keys produced by
    `_collect_score_rows` in main.py. Synchronous — called from the admin
    "Sync to Sheet" handler.
    """
    if not is_configured():
        return {"ok": False, "error": "Sheets backup not configured (GOOGLE_SHEETS_CREDENTIALS_JSON / SHEET_ID)"}
    try:
        svc = _build_service()
    except Exception as e:
        return {"ok": False, "error": f"could not build Sheets client: {e}"}
    formatted: list[tuple[str, list[Any]]] = []
    for r in rows:
        score = {
            "innovation": r["innovation"],
            "technical": r["technical"],
            "impact": r["impact"],
            "presentation": r["presentation"],
            "total_weighted": r["total_weighted"],
            "notes": r.get("notes") or "",
            "updated_at": r.get("updated_at") or "",
        }
        judge = {"id": r["judge_id"]}
        project = {
            "id": r["project_id"],
            "title": r.get("project_title"),
            "team_name": r.get("team_name"),
        }
        formatted.append(_format_row(score, judge, project))
    try:
        with _lock:
            result = _upsert_rows(svc, _env_sheet_id(), _env_tab_name(), formatted)
    except Exception as e:
        return {"ok": False, "error": f"Sheets write failed: {e}"}
    return {"ok": True, **result, "tab": _env_tab_name()}


def send_test() -> dict:
    """Round-trip a probe row to the configured tab. Returns a dict the admin UI renders."""
    if not is_configured():
        return {"ok": False, "error": "GOOGLE_SHEETS_CREDENTIALS_JSON / SHEET_ID not set"}
    try:
        svc = _build_service()
    except Exception as e:
        return {"ok": False, "error": f"client build failed: {e}"}
    probe = {
        "innovation": 0,
        "technical": 0,
        "impact": 0,
        "presentation": 0,
        "total_weighted": 0,
        "notes": "round-trip self-test",
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    judge = {"id": "self-test"}
    project = {"id": 0, "title": "self-test", "team_name": "self-test"}
    try:
        with _lock:
            result = _upsert_rows(svc, _env_sheet_id(), _env_tab_name(),
                                  [_format_row(probe, judge, project)])
    except Exception as e:
        return {"ok": False, "error": f"write failed: {e}"}
    return {"ok": True, "tab": _env_tab_name(), **result}
