"""JWT auth for judges, password auth for organizers."""
import os
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt

from database import get_conn

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret-change-me-please")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin")
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
    return secrets.compare_digest(password, ADMIN_PASSWORD)


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


def verify_pin(event_id: int, pin: str) -> Optional[dict]:
    conn = get_conn()
    row = conn.execute(
        "SELECT * FROM judges WHERE event_id = ? AND pin = ?", (event_id, pin)
    ).fetchone()
    return dict(row) if row else None
