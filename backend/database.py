"""Dual-backend DB layer: Postgres via DATABASE_URL, SQLite locally.

Same call sites in `main.py`/`seed.py`. All queries use `?` placeholders;
the wrapper rewrites to `%s` for psycopg. Rows behave like dicts on both.
Use `insert_returning_id` for INSERT…lastrowid (portable to PG via RETURNING).
"""
from __future__ import annotations

import glob
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
# Railway/Heroku style → SQLAlchemy/psycopg style
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]

USE_PG = DATABASE_URL.startswith("postgresql://")

DB_PATH = os.environ.get("DB_PATH", str(Path(__file__).parent.parent / "judging.db"))
BACKUP_DIR = Path(__file__).parent.parent / "backups"
BACKUP_DIR.mkdir(exist_ok=True)

_pool = None
if USE_PG:
    import psycopg2  # type: ignore
    import psycopg2.extras  # type: ignore
    from psycopg2.pool import ThreadedConnectionPool  # type: ignore
    _pool = ThreadedConnectionPool(1, 20, dsn=DATABASE_URL)


_local = threading.local()


class Conn:
    """Wraps either sqlite3.Connection or psycopg2 connection.

    All call sites use `?` placeholders; we rewrite for PG.
    Rows are accessible by string key on both backends.
    """

    def __init__(self, raw, kind: str):
        self.raw = raw
        self.kind = kind  # 'pg' or 'sqlite'

    def _adapt(self, sql: str) -> str:
        if self.kind == "pg":
            # Translate ?-placeholders to %s, but skip any inside string literals.
            out, i, n = [], 0, len(sql)
            in_s = False
            while i < n:
                ch = sql[i]
                if ch == "'":
                    in_s = not in_s
                    out.append(ch)
                elif ch == "?" and not in_s:
                    out.append("%s")
                else:
                    out.append(ch)
                i += 1
            return "".join(out)
        return sql

    def execute(self, sql: str, params=()):
        sql = self._adapt(sql)
        if self.kind == "pg":
            cur = self.raw.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(sql, tuple(params) if params else None)
            return cur
        return self.raw.execute(sql, params)

    def executescript(self, sql: str):
        if self.kind == "pg":
            cur = self.raw.cursor()
            cur.execute(sql)
            cur.close()
        else:
            self.raw.executescript(sql)


def insert_returning_id(conn: Conn, sql: str, params=()) -> int:
    """Run an INSERT and return the new id, portably across backends."""
    if conn.kind == "pg":
        s = sql.rstrip().rstrip(";")
        if "returning" not in s.lower():
            s += " RETURNING id"
        cur = conn.execute(s, params)
        row = cur.fetchone()
        return int(row["id"])
    cur = conn.execute(sql, params)
    return int(cur.lastrowid)


def get_conn() -> Conn:
    conn = getattr(_local, "conn", None)
    if conn is None:
        if USE_PG:
            assert _pool is not None
            raw = _pool.getconn()
            raw.autocommit = True
            conn = Conn(raw, "pg")
        else:
            raw = sqlite3.connect(
                DB_PATH, isolation_level=None, check_same_thread=False, timeout=10
            )
            raw.row_factory = sqlite3.Row
            raw.execute("PRAGMA journal_mode=WAL")
            raw.execute("PRAGMA synchronous=NORMAL")
            raw.execute("PRAGMA busy_timeout=5000")
            raw.execute("PRAGMA foreign_keys=ON")
            conn = Conn(raw, "sqlite")
        _local.conn = conn
    return conn


@contextmanager
def tx():
    conn = get_conn()
    if conn.kind == "pg":
        conn.raw.autocommit = False
        try:
            yield conn
            conn.raw.commit()
        except Exception:
            conn.raw.rollback()
            raise
        finally:
            conn.raw.autocommit = True
    else:
        conn.raw.execute("BEGIN IMMEDIATE")
        try:
            yield conn
            conn.raw.execute("COMMIT")
        except Exception:
            conn.raw.execute("ROLLBACK")
            raise


SCHEMA_SQLITE = """
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
    devpost_url TEXT,
    hours_expected REAL DEFAULT 4,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS judges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    expertise TEXT,
    pin TEXT NOT NULL,
    token_hash TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP
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
    submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    sync_status TEXT DEFAULT 'synced',
    UNIQUE(judge_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_judges_event ON judges(event_id);
CREATE INDEX IF NOT EXISTS idx_projects_event ON projects(event_id);
CREATE INDEX IF NOT EXISTS idx_scores_judge ON scores(judge_id);
CREATE INDEX IF NOT EXISTS idx_scores_project ON scores(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_event_devpost
    ON projects (event_id, devpost_url) WHERE devpost_url IS NOT NULL;
"""

SCHEMA_PG = """
CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
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
    hours_expected DOUBLE PRECISION DEFAULT 4,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS judges (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    expertise TEXT,
    pin TEXT NOT NULL,
    token_hash TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id BIGSERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    team_name TEXT,
    table_number TEXT,
    track TEXT,
    description TEXT,
    devpost_url TEXT,
    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scores (
    id BIGSERIAL PRIMARY KEY,
    judge_id BIGINT NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
    project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    innovation DOUBLE PRECISION,
    technical DOUBLE PRECISION,
    impact DOUBLE PRECISION,
    presentation DOUBLE PRECISION,
    total_raw DOUBLE PRECISION,
    total_weighted DOUBLE PRECISION,
    notes TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sync_status TEXT DEFAULT 'synced',
    UNIQUE(judge_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_judges_event ON judges(event_id);
CREATE INDEX IF NOT EXISTS idx_projects_event ON projects(event_id);
CREATE INDEX IF NOT EXISTS idx_scores_judge ON scores(judge_id);
CREATE INDEX IF NOT EXISTS idx_scores_project ON scores(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_event_devpost
    ON projects (event_id, devpost_url) WHERE devpost_url IS NOT NULL;
"""


def init_db() -> None:
    conn = get_conn()
    conn.executescript(SCHEMA_PG if USE_PG else SCHEMA_SQLITE)
    # Idempotent migrations for already-deployed DBs that pre-date a column.
    _ensure_column(conn, "events", "devpost_url", "TEXT")
    _ensure_column(conn, "projects", "robot_arm", "TEXT")
    _ensure_column(conn, "projects", "github_url", "TEXT")
    _ensure_column(conn, "projects", "x_post_url", "TEXT")
    _ensure_column(conn, "projects", "huggingface_url", "TEXT")


def _ensure_column(conn: Conn, table: str, column: str, decl: str) -> None:
    """Add `column` to `table` if it doesn't exist. Works on both backends."""
    try:
        if conn.kind == "pg":
            row = conn.execute(
                """SELECT 1 FROM information_schema.columns
                   WHERE table_name = ? AND column_name = ?""",
                (table, column),
            ).fetchone()
            if not row:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
        else:
            cols = conn.execute(f"PRAGMA table_info({table})").fetchall()
            existing = {(c["name"] if isinstance(c, dict) else c[1]) for c in cols}
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
    except Exception as e:
        print(f"[init_db] ensure_column {table}.{column} skipped: {e}")


# ---------- SQLite-only file backup (no-op for Postgres) ----------
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
    if USE_PG:
        return  # Postgres handles its own backups
    if _backup_thread is None or not _backup_thread.is_alive():
        _stop_backup.clear()
        _backup_thread = threading.Thread(target=_backup_loop, daemon=True)
        _backup_thread.start()


def stop_backup_scheduler() -> None:
    _stop_backup.set()
