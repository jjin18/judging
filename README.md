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
python backend/seed.py              # cmd-f 2025 + 10 dummy judges
open http://localhost:5173          # picks up all three routes
```

Default admin password: `admin`. Judge PINs = normalized names (`Jia Jin` → `jiajin`).

| Judge        | PIN          |
|--------------|--------------|
| Jia Jin      | `jiajin`     |
| Daniel Park  | `danielpark` |
| Asha Patel   | `ashapatel`  |
| Marcus Chen  | `marcuschen` |
| Priya Iyer   | `priyaiyer`  |
| Liam O'Brien | `liamobrien` |
| Sofia Reyes  | `sofiareyes` |
| Hiro Tanaka  | `hirotanaka` |
| Nadia Volkov | `nadiavolkov`|
| Eli Kim      | `elikim`     |

`Jia Jin` / `jia jin` / `JIA JIN` / `jiajin` all match — case, spaces, accents, and punctuation are folded.

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

The first boot with an empty Postgres DB auto-seeds the cmd-f 2025 event + 10 dummy judges. Set `SKIP_AUTO_SEED=1` to disable.

### 2. Off-platform backup: Google Sheets

Every score and every team submission is mirrored, fire-and-forget, to a Google Sheet via Apps Script. If Railway burns down, the spreadsheet is the source of truth.

**One-time setup** (5 min):

1. Create a new Google Sheet. Add two tabs named `scores` and `submissions`.
2. **Extensions → Apps Script**, paste this:

   ```js
   const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();
   function doPost(e) {
     const p = JSON.parse(e.postData.contents);
     const ss = SpreadsheetApp.openById(SHEET_ID);
     const tab = p.kind === 'score' ? 'scores' : 'submissions';
     const sh = ss.getSheetByName(tab) || ss.insertSheet(tab);
     if (sh.getLastRow() === 0) sh.appendRow(Object.keys(p));
     const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
     sh.appendRow(headers.map(h => p[h] ?? ''));
     return ContentService.createTextOutput('ok');
   }
   ```

3. **Deploy → New deployment → Web app**, execute as **Me**, access **Anyone**.
4. Copy the deployment URL → set as `GOOGLE_SHEETS_WEBHOOK_URL` on Railway.

The boot log will show `[boot] Google Sheets backup: enabled` and `/api/health` will report `"sheets_backup": true`. Score and submission rows now also appear in the spreadsheet within seconds.

### Recovery: if Postgres is gone

You have three independent copies of the data:

1. **The Sheet** — every score + submission since you set up the webhook.
2. **`/api/admin/export/scores`** — full CSV download from the running app.
3. **IndexedDB on each judge's device** — their own scores survive a server outage and re-sync when the server comes back (offline queue → idempotent upsert).

To rebuild from the Sheet: download as CSV, run a one-shot import — or just open `/admin → Setup` and re-create the event, then have judges sign in (their device pushes queued scores) and have teams resubmit (idempotent on the Devpost link).

## Required env

```
ADMIN_PASSWORD=...         # organizer login (default: admin)
JWT_SECRET=...             # signing secret (defaults to a dev secret — change!)
DATABASE_URL=...           # postgresql://… — Railway sets this automatically
GOOGLE_SHEETS_WEBHOOK_URL= # Apps Script web app URL (optional but recommended)
FRONTEND_BASE_URL=https://yourapp.com   # used in QR codes
SKIP_AUTO_SEED=1           # disable empty-DB auto-seed
MIGRATE_PINS_TO_NAMES=1    # one-shot: rewrite numeric PINs to normalized names
DB_PATH=./judging.db       # only used when DATABASE_URL is unset
```

## Project structure

```
backend/
  main.py            FastAPI routes (submit + judge + admin)
  database.py        Dual SQLite/Postgres layer; idempotent ALTERs
  auth.py            JWT for judges + admin password
  sheets_backup.py   Apps Script webhook mirror (fire-and-forget)
  seed.py            Dev fixtures (event + 10 judges, no projects)
frontend/
  public/sw.js       Service worker — offline POST passthrough
  src/
    App.jsx          Routes /submit /judge /admin + landing
    submit/          Public team submission form
    judge/           Two-panel dashboard, scoring, PDF letter
    admin/           Event sidebar, setup/projects/judges tabs
    lib/             db.js (IndexedDB), sync.js (queue), api.js
```

## Data model

```sql
events     (id, name, date, venue, ..., devpost_url, hours_expected)
judges     (id, event_id, name, email, expertise, pin)
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
