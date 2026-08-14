"""Creating the athlete profile must tolerate losing a race.

Hit during a live user test, on the very first load after registering: the app
requests /api/profile more than once concurrently, both requests found no
profile row, both inserted, and the loser returned a 500.

    sqlalchemy.exc.IntegrityError: UNIQUE constraint failed: athlete_profile.user_id

Read-then-create is only safe if losing the insert is handled, so that's what
this pins.
"""
from __future__ import annotations

from app.ai.service import get_or_create_profile
from app.db import SessionLocal
from app.models import AthleteProfile, User


def _fresh_user(email: str) -> int:
    db = SessionLocal()
    try:
        user = User(email=email, display_name="Racer", password_hash="x")
        db.add(user)
        db.commit()
        return user.id
    finally:
        db.close()


def test_a_profile_is_created_on_first_ask():
    uid = _fresh_user("race-one@example.com")
    db = SessionLocal()
    try:
        assert get_or_create_profile(db, uid).user_id == uid
    finally:
        db.close()


def test_asking_twice_returns_the_same_profile():
    uid = _fresh_user("race-two@example.com")
    a, b = SessionLocal(), SessionLocal()
    try:
        assert get_or_create_profile(a, uid).id == get_or_create_profile(b, uid).id
    finally:
        a.close()
        b.close()


def test_losing_the_insert_race_returns_the_winners_row(monkeypatch):
    """The failing interleaving: read "no profile", *then* someone else commits
    one, then you insert. Simply calling twice in sequence never reproduces it,
    because the second call's SELECT already sees the winner's row — so the
    stale read is forced here.
    """
    uid = _fresh_user("race-three@example.com")
    winner, loser = SessionLocal(), SessionLocal()
    try:
        won = get_or_create_profile(winner, uid)

        reads = {"n": 0}
        real_scalar = loser.scalar

        def stale_first_read(*args, **kwargs):
            reads["n"] += 1
            # The read that happened before the winner committed.
            return None if reads["n"] == 1 else real_scalar(*args, **kwargs)

        monkeypatch.setattr(loser, "scalar", stale_first_read)

        recovered = get_or_create_profile(loser, uid)
        assert recovered.user_id == uid
        assert recovered.id == won.id
    finally:
        loser.close()
        winner.close()


def test_only_one_profile_row_survives_a_race():
    uid = _fresh_user("race-four@example.com")
    a, b = SessionLocal(), SessionLocal()
    try:
        get_or_create_profile(a, uid)
        get_or_create_profile(b, uid)
    finally:
        a.close()
        b.close()

    db = SessionLocal()
    try:
        rows = db.scalars(
            AthleteProfile.__table__.select().where(AthleteProfile.user_id == uid)
        ).all()
        assert len(rows) == 1
    finally:
        db.close()
