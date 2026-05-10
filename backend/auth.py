"""JWT auth for judges, password auth for organizers."""
import os
import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt

from database import get_conn


PIN_RE = re.compile(r"^\d{6}$")


def normalize_pin(s: str) -> str:
    """Strip everything that isn't a digit. PINs are 6-digit numeric."""
    if not s:
        return ""
    return "".join(ch for ch in s if ch.isdigit())


def is_valid_pin(s: str) -> bool:
    return bool(s) and PIN_RE.match(s) is not None


def _existing_pins() -> set[str]:
    rows = get_conn().execute("SELECT pin FROM judges").fetchall()
    return {(r["pin"] if isinstance(r, dict) else r[0]) for r in rows if (r["pin"] if isinstance(r, dict) else r[0])}


def generate_pin(existing: Optional[set[str]] = None) -> str:
    """Cryptographically random 6-digit PIN, unique across all judges.

    If `existing` is None, queries the DB for current PINs. Pass in a set when
    generating a batch in one transaction so newly-allocated PINs in that batch
    don't collide with each other.
    """
    if existing is None:
        existing = _existing_pins()
    for _ in range(2000):
        candidate = f"{secrets.randbelow(1_000_000):06d}"
        if candidate not in existing:
            existing.add(candidate)
            return candidate
    raise RuntimeError("could not allocate a unique 6-digit PIN")


JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me-please")

DEFAULT_ADMIN_PASSWORD = "PhysicalAIHacks2026!"
# `os.environ.get(name, default)` only uses the default when the var is unset,
# not when it's set to an empty string. Operators on Railway routinely "clear"
# the var by saving an empty value — fall back to the hardcoded default in
# both cases. Strip whitespace so a stray newline from copy-paste doesn't lock
# everyone out.
ADMIN_PASSWORD = (os.environ.get("ADMIN_PASSWORD") or "").strip() or DEFAULT_ADMIN_PASSWORD

JUDGE_TOKEN_DAYS = 30


def make_judge_token(judge_id: int, event_id: int) -> str:
    payload = {
        "sub": str(judge_id),
        "event_id": event_id,
        "kind": "judge",
        "exp": datetime.now(timezone.utc) + timedelta(days=JUDGE_TOKEN_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def make_admin_token() -> str:
    payload = {
        "sub": "admin",
        "kind": "admin",
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def verify_password(password: str) -> bool:
    """Admin password check. Constant-time, trimmed both sides, never silently
    truncates. Explicitly refuses any value that also matches a judge PIN —
    defends against `ADMIN_PASSWORD` accidentally colliding with a judge PIN
    or a judge submitting their PIN against the admin login endpoint.
    """
    if not password:
        return False
    submitted = password.strip()
    if not submitted:
        return False
    if not secrets.compare_digest(submitted, ADMIN_PASSWORD):
        return False
    if submitted in _existing_pins():
        return False
    return True


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except JWTError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"invalid token: {e}")


def _bearer(authorization: Optional[str]) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    return authorization.split(" ", 1)[1].strip()


def require_admin_q(authorization: Optional[str] = Header(None), token: Optional[str] = None) -> dict:
    """Admin auth that accepts either Authorization header or ?token= query param.

    Used for endpoints downloaded directly via <a href> or <img src>, which can't carry headers.
    """
    if authorization:
        raw = _bearer(authorization)
    elif token:
        raw = token
    else:
        raise HTTPException(status_code=401, detail="missing token")
    payload = _decode(raw)
    if payload.get("kind") != "admin":
        raise HTTPException(status_code=403, detail="not an admin token")
    return payload


def require_judge(authorization: Optional[str] = Header(None)) -> dict:
    payload = _decode(_bearer(authorization))
    if payload.get("kind") != "judge":
        raise HTTPException(status_code=403, detail="not a judge token")
    judge_id = int(payload["sub"])
    conn = get_conn()
    row = conn.execute("SELECT * FROM judges WHERE id = ?", (judge_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="judge not found")
    return dict(row)


def require_admin(authorization: Optional[str] = Header(None)) -> dict:
    payload = _decode(_bearer(authorization))
    if payload.get("kind") != "admin":
        raise HTTPException(status_code=403, detail="not an admin token")
    return payload


def verify_pin(pin: str, event_id: Optional[int] = None) -> Optional[dict]:
    """Look up a judge by exact 6-digit PIN.

    Names (or any name-derived value) never authenticate — the judge must enter
    the assigned PIN.
    """
    norm = normalize_pin(pin)
    if not is_valid_pin(norm):
        return None
    conn = get_conn()
    if event_id is not None:
        row = conn.execute(
            "SELECT * FROM judges WHERE event_id = ? AND pin = ?",
            (event_id, norm),
        ).fetchone()
    else:
        row = conn.execute(
            """SELECT j.* FROM judges j
               JOIN events e ON e.id = j.event_id
               WHERE j.pin = ?
               ORDER BY e.created_at DESC, j.id DESC
               LIMIT 1""",
            (norm,),
        ).fetchone()
    return dict(row) if row else None
