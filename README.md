# Hackathon Judging Platform

Three routes, one codebase. Offline-first. Mobile-first for judges.

```
/submit  → teams register their project
/judge   → judges score projects
/admin   → organizer workspace
```

## Quick start

```bash
./start.sh                          # backend :8000 + Vite :5173
python backend/seed.py              # 1 event + 10 dummy judges
open http://localhost:5173          # picks up all three routes
```

Default admin password: `PhysicalAIHacks2026!` (override with the
`ADMIN_PASSWORD` env var; empty / whitespace-only values fall back to the
default rather than locking everyone out). The admin token lives in React
memory only — closing the tab signs you out.

Judge PINs are random 6-digit numeric codes allocated at create-time and
printed by `seed.py` (20 dummy judges by default). Names never log in;
judges enter their PIN at `/judge`. The PIN-auth endpoint is rate-limited
to 10 attempts per minute per IP. The judge token lives in
`sessionStorage` — closing the tab signs them out, but a refresh inside
the same tab does not. Admins can read every judge's PIN from the
**Judges** tab in the admin dashboard.

## Score reliability

Three layers protect every score:

1. **Local autosave on every keystroke.** The score form writes the
   in-progress values to `localStorage` keyed on `(judge_id, project_id)`.
   A force-quit / browser kill loses no input. On return, a "Draft
   restored" badge tells the judge their input came back.
2. **DB write before "Submitted" appears.** The submit handler writes the
   row synchronously and only surfaces success once the DB returns OK.
   The local draft is cleared only after a confirmed server response.
3. **Sheets sync inside the request.** After the DB write, the handler
   pushes the row to Google Sheets. Only on success does the row's
   `sync_status` flip to `submitted`; on failure it stays `pending_sync`,
   the judge sees "Saved — syncing…", and a background loop replays it
   automatically. The admin **Backup** tab shows the live Sheet link,
   last-success timestamp, pending count, and "Retry now" + "Sync all"
   buttons.

Re-submitting for the same `(judge_id, project_id)` is an upsert in both
the DB (`UNIQUE` constraint enforces one row per pair) and the Sheet
(`sync_all` is idempotent). The leaderboard average is over distinct
judges only.

## Deployment (Railway, with Postgres + Sheets backup)

The container ships ready for Railway. The platform's filesystem is **ephemeral**, so SQLite data evaporates on each redeploy — Postgres is required for persistence.

### 1. Attach Postgres on Railway

In the Railway project: **+ New → Database → PostgreSQL**. Railway auto-injects `DATABASE_URL` into the web service's env. Redeploy.

Verify:

```bash
curl https://your-app/api/health
# {"ok":true,"db":"postgres","counts":{...},"sheets_backup":...}
```

If `db` shows `sqlite` in production, the DATABASE_URL isn't reaching the service — check the variable wiring.

The first boot with an empty Postgres DB auto-seeds the dummy event + 10 judges. Set `SKIP_AUTO_SEED=1` to disable. Any judge PIN that isn't a valid 6-digit code (e.g. legacy name-derived values) is rewritten to a fresh random one on first boot.

### 2. Off-platform backup: Google Sheets (service account)

Every score upsert is mirrored, fire-and-forget, to a Google Sheet through
the Sheets API v4 using a service account. If Railway burns down, the
spreadsheet is the source of truth.

**One-time setup**:

1. **Create a Google Cloud service account.**
   In the Cloud Console: *IAM & Admin → Service Accounts → Create Service Account*.
   Skip granting any project-level role. **Keys → Add Key → JSON** and download
   the file. The JSON contains a `client_email` field — note it.

2. **Enable the Sheets API** for the project:
   *APIs & Services → Library → Google Sheets API → Enable*.

3. **Create a Google Sheet.** Open it, click **Share**, paste the service
   account's `client_email`, set Editor, and uncheck "Notify". Note the
   spreadsheet ID from the URL (`docs.google.com/spreadsheets/d/<SHEET_ID>/edit`)
   and the tab name (default: `scores`).

4. **Configure env vars** on Railway → web service → Variables:

   | Variable                        | Value                                                  |
   | ------------------------------- | ------------------------------------------------------ |
   | `GOOGLE_SHEETS_CREDENTIALS_JSON` | The full JSON key file contents, pasted as one string. |
   | `SHEET_ID`                      | The spreadsheet ID from the URL.                       |
   | `SHEET_TAB_NAME`                | Tab name to write to (defaults to `scores`).           |

   Save (Railway redeploys automatically).

5. **Verify.** Reload `/admin`. The banner turns green. Click **Test** to
   write a probe row to the configured tab. Click **Sync to Sheet** to
   re-export every score in the DB (idempotent — keyed on judge_id +
   team/project).

The mirror runs in a daemon thread on every score submit. The first row to
each tab lays down the header `timestamp, judge_id, team_or_project,
criterion_scores, total, comments`. PINs are never written to the sheet —
only `judge_id`.

### Recovery: if Postgres is gone

You have three independent copies of the data:

1. **The Sheet** — every score since you set up the credentials.
2. **`/api/admin/export/scores`** — full CSV download from the running app.
3. **IndexedDB on each judge's device** — their own scores survive a server outage and re-sync when the server comes back (offline queue → idempotent upsert).

To rebuild from the Sheet: download as CSV, run a one-shot import — or just open `/admin → Setup` and re-create the event, then have judges sign in (their device pushes queued scores) and have teams resubmit (idempotent on the Devpost link).

## Required env

```
ADMIN_PASSWORD=...                 # organizer login (default: PhysicalAIHacks2026!)
JWT_SECRET=...                     # signing secret (defaults to a dev secret — change!)
DATABASE_URL=...                   # postgresql://… — Railway sets this automatically
GOOGLE_SHEETS_CREDENTIALS_JSON=... # service-account JSON (optional but recommended)
SHEET_ID=...                       # spreadsheet ID (from the URL)
SHEET_TAB_NAME=scores              # tab to write to (defaults to "scores")
FRONTEND_BASE_URL=https://yourapp.com   # used in QR codes
SKIP_AUTO_SEED=1                   # disable empty-DB auto-seed
DB_PATH=./judging.db               # only used when DATABASE_URL is unset
```

## Project structure

```
backend/
  main.py            FastAPI routes (submit + judge + admin)
  database.py        Dual SQLite/Postgres layer; idempotent ALTERs
  auth.py            JWT for judges + admin password + PIN allocation
  sheets_backup.py   Google Sheets service-account mirror (fire-and-forget)
  seed.py            Dev fixtures (event + 10 judges, no projects)
  test_auth.py       Auth + Sheets-backup tests (pytest)
frontend/
  public/sw.js       Service worker — offline POST passthrough
  src/
    App.jsx          Routes /submit /judge /admin + landing
    submit/          Public team submission form
    judge/           Two-panel dashboard, scoring
    admin/           Event sidebar, setup/projects/judges tabs
    lib/             db.js (IndexedDB), sync.js (queue), api.js
```

## Tests

```bash
cd backend && pytest -q
```

Covers PIN auth, admin/judge auth separation, ADMIN_PASSWORD/PIN collision
detection, and the score → Sheets mirror (mocked).

## Data model

```sql
events     (id, name, date, venue, ..., devpost_url, hours_expected)
judges     (id, event_id, name, email, expertise, pin)        -- pin = 6 digits
projects   (id, event_id, title, team_name, table_number, track,
            description, devpost_url)
            UNIQUE (event_id, devpost_url) WHERE devpost_url IS NOT NULL
scores     (id, judge_id, project_id,
            innovation, technical, impact, presentation,
            total_raw, total_weighted, notes,
            sync_status, updated_at,
            UNIQUE(judge_id, project_id))
```

All score writes are idempotent `INSERT … ON CONFLICT DO UPDATE`. All team submissions are idempotent on `(event_id, devpost_url)`.
