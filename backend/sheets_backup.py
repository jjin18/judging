"""Fire-and-forget Google Sheets backup via Apps Script webhook.

Set GOOGLE_SHEETS_WEBHOOK_URL to the published-as-web-app URL of an Apps
Script that takes a JSON payload and appends a row. See README for setup.

The backup is best-effort: failures are logged but never block the user.
Every score and every team submission is mirrored, so if the primary DB
is wiped we can re-import from the spreadsheet.
"""
from __future__ import annotations

import json
import os
import threading
from urllib import request as _request
from urllib.error import URLError, HTTPError


def _webhook_url() -> str:
    return os.environ.get("GOOGLE_SHEETS_WEBHOOK_URL", "").strip()


def _post(payload: dict) -> None:
    url = _webhook_url()
    if not url:
        return
    try:
        body = json.dumps(payload).encode("utf-8")
        req = _request.Request(
            url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with _request.urlopen(req, timeout=5) as resp:
            if resp.status >= 300:
                print(f"[sheets] non-2xx: {resp.status}")
    except (HTTPError, URLError, TimeoutError, OSError) as e:
        print(f"[sheets] webhook failed: {e}")
    except Exception as e:
        print(f"[sheets] unexpected error: {e}")


def mirror_score(score_row: dict, judge: dict, project: dict) -> None:
    """Mirror a score upsert. Called from the API handler; runs in a thread."""
    payload = {
        "kind": "score",
        "event_id": project.get("event_id"),
        "judge_id": judge.get("id"),
        "judge_name": judge.get("name"),
        "project_id": project.get("id"),
        "project_title": project.get("title"),
        "team_name": project.get("team_name"),
        "table_number": project.get("table_number"),
        "devpost_url": project.get("devpost_url"),
        "innovation": score_row.get("innovation"),
        "technical": score_row.get("technical"),
        "impact": score_row.get("impact"),
        "presentation": score_row.get("presentation"),
        "total_raw": score_row.get("total_raw"),
        "total_weighted": score_row.get("total_weighted"),
        "notes": score_row.get("notes"),
        "updated_at": str(score_row.get("updated_at") or ""),
    }
    threading.Thread(target=_post, args=(payload,), daemon=True).start()


def mirror_submission(project_row: dict) -> None:
    """Mirror a team submission. Called from /api/submit; runs in a thread."""
    payload = {
        "kind": "submission",
        "event_id": project_row.get("event_id"),
        "project_id": project_row.get("id"),
        "title": project_row.get("title"),
        "team_name": project_row.get("team_name"),
        "table_number": project_row.get("table_number"),
        "track": project_row.get("track"),
        "devpost_url": project_row.get("devpost_url"),
    }
    threading.Thread(target=_post, args=(payload,), daemon=True).start()
