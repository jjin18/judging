# Hackathon Judging Platform

Two routes, one codebase. Offline-first. Mobile-first for judges.

```
yourapp.com/judge   → Judge dashboard (QR or PIN auth)
yourapp.com/admin   → Organizer workspace (password auth)
```

## Quick start

```bash
./start.sh                         # backend :8000 + frontend :5173
python backend/seed.py             # 1 event, 10 judges, 50 projects, sample scores
open http://localhost:5173/judge   # PIN login (event id 1, see seed output)
open http://localhost:5173/admin   # admin password (default: "admin")
```

Required env (defaults are dev-only):

```
ADMIN_PASSWORD=...   # organizer login
JWT_SECRET=...       # signing secret for judge + admin tokens
DB_PATH=./judging.db # SQLite path (default: repo root)
FRONTEND_BASE_URL=https://yourapp.com   # used in QR codes
```

## Production

Build the frontend, then run the API. The backend serves the built SPA.

```bash
NODE_ENV=production ./start.sh prod
```

Or one-shot for Railway/Fly:

```bash
cd frontend && npm install && npm run build && cd ..
pip install -r backend/requirements.txt
cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT
```

`railway.json` and `Procfile` are included.

## Reliability checklist

- [x] Reload mid-scoring → all sliders restored from IndexedDB
- [x] Score offline → reconnect → queue flushes in order
- [x] SQLite WAL + 5s busy timeout → concurrent writes safe
- [x] Phone dies, relaunches → full state back fast (cached locally)
- [x] PIN auth works with server completely offline (cached profile + queued POSTs)
- [x] Backups in `/backups/` every 60s, last 20 retained
- [x] Leaderboard consolidates all judges (avg of `total_weighted`)

## Project structure

```
backend/
  main.py            FastAPI routes (judge + admin)
  database.py        SQLite WAL, 60s backup scheduler
  auth.py            JWT (HS256) for judges + admin password
  models.py          Pydantic schemas
  scrape_devpost.py  CLI + streaming scrape endpoint
  seed.py            Dev fixtures
frontend/
  public/sw.js       Service worker — offline POST passthrough
  src/
    App.jsx          Route split: /judge → JudgeApp, /admin → AdminApp
    judge/           Two-panel dashboard, scoring, letter, PDF
    admin/           Event sidebar, setup/projects/judges tabs
    lib/             db.js (IndexedDB), sync.js (queue), api.js
```

## Data model

```sql
events     (id, name, date, venue, city, org_*, organizer_*, hours_expected)
judges     (id, event_id, name, email, expertise, pin)
projects   (id, event_id, title, team_name, table_number, track, description, devpost_url)
scores     (id, judge_id, project_id,
            innovation, technical, impact, presentation,
            total_raw, total_weighted, notes,
            sync_status, updated_at,
            UNIQUE(judge_id, project_id))
```

All score writes are `INSERT … ON CONFLICT(judge_id, project_id) DO UPDATE` — idempotent.

## Scraping Devpost

```bash
python backend/scrape_devpost.py https://your-hackathon.devpost.com --limit 200
```

Or use the **Projects → Scrape Devpost** UI in `/admin` — it streams progress live and persists rows as they come in.
