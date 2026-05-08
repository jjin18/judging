"""SQLite database with WAL mode and 60s backup scheduler."""
import os
import sqlite3
import threading
import time
import shutil
import glob
from pathlib import Path
from contextlib import contextmanager

DB_PATH = os.environ.get("DB_PATH", str(Path(__file__).parent.parent / "judging.db"))
BACKUP_DIR = Path(__file__).parent.parent / "backups"
BACKUP_DIR.mkdir(exist_ok=True)

_local = threading.local()


def get_conn() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(DB_PATH, isolation_level=None, check_same_thread=False, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return conn


@contextmanager
def tx():
    conn = get_conn()
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    date TEXT,
    venue TEXT,
    city TEXT,
    org_name TEXT,
    org_address TEXT,
    org_website TEXT,
    organizer_name TEXT,
    organizer_title TEXT,
    logo_path TEXT,
    hours_expected REAL DEFAULT 4,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS judges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    expertise TEXT,
    pin TEXT NOT NULL,
    token_hash TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    team_name TEXT,
    table_number TEXT,
    track TEXT,
    description TEXT,
    devpost_url TEXT,
    imported_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    judge_id INTEGER NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    innovation REAL,
    technical REAL,
    impact REAL,
    presentation REAL,
    total_raw REAL,
    total_weighted REAL,
    notes TEXT,
    submitted_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    sync_status TEXT DEFAULT 'synced',
    UNIQUE(judge_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_judges_event ON judges(event_id);
CREATE INDEX IF NOT EXISTS idx_projects_event ON projects(event_id);
CREATE INDEX IF NOT EXISTS idx_scores_judge ON scores(judge_id);
CREATE INDEX IF NOT EXISTS idx_scores_project ON scores(project_id);
"""


def init_db() -> None:
    conn = get_conn()
    conn.executescript(SCHEMA)


_backup_thread: threading.Thread | None = None
_stop_backup = threading.Event()


def _backup_loop() -> None:
    while not _stop_backup.is_set():
        try:
            ts = int(time.time())
            target = BACKUP_DIR / f"scores_{ts}.db"
            src = sqlite3.connect(DB_PATH)
            dst = sqlite3.connect(str(target))
            with dst:
                src.backup(dst)
            src.close()
            dst.close()
            backups = sorted(glob.glob(str(BACKUP_DIR / "scores_*.db")))
            for old in backups[:-20]:
                try:
                    os.remove(old)
                except OSError:
                    pass
        except Exception as e:
            print(f"[backup] failed: {e}")
        _stop_backup.wait(60)


def start_backup_scheduler() -> None:
    global _backup_thread
    if _backup_thread is None or not _backup_thread.is_alive():
        _stop_backup.clear()
        _backup_thread = threading.Thread(target=_backup_loop, daemon=True)
        _backup_thread.start()


def stop_backup_scheduler() -> None:
    _stop_backup.set()
