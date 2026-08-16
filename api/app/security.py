"""Password hashing and JWT auth helpers."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .models import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return pwd_context.verify(plain, hashed)
    except ValueError:
        return False


def create_token(user_id: int, extra: dict | None = None, minutes: int | None = None) -> str:
    """A session token, or — with `extra` and a short life — a signed carrier
    for something that has to survive a round trip through a third party.

    The OAuth flow uses the second form for its `state`: signing where to
    redirect back to, rather than trusting whatever comes back, is what stops a
    tampered redirect from being handed our session token.
    """
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expires = (
        now + timedelta(minutes=minutes)
        if minutes is not None
        else now + timedelta(hours=settings.jwt_expire_hours)
    )
    payload = {"sub": str(user_id), "iat": now, "exp": expires, **(extra or {})}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token_claims(token: str) -> dict:
    """Every claim in a token we signed. Raises if it's expired or tampered."""
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


def decode_token(token: str) -> int:
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    user_id = decode_token(credentials.credentials)
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    return user
