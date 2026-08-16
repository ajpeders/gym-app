"""Database engine, session factory, and FastAPI dependency."""
from __future__ import annotations

import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine():
    settings = get_settings()
    # Ensure the data directory exists for file-based SQLite.
    if settings.database_url.startswith("sqlite:///") and "/:memory:" not in settings.database_url:
        os.makedirs(settings.data_dir, exist_ok=True)
    return create_engine(
        settings.database_url,
        connect_args={"check_same_thread": False},
        future=True,
    )


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


# Lightweight additive migrations for SQLite (no Alembic yet): columns added to
# existing tables after first deploy. create_all() only creates missing *tables*,
# so new columns on existing tables must be ALTERed in. Idempotent.
_ADDED_COLUMNS: list[tuple[str, str, str]] = [
    ("athlete_profile", "height", "FLOAT"),
    ("athlete_profile", "current_weight", "FLOAT"),
    ("athlete_profile", "goal_weight", "FLOAT"),
    ("workout_exercise", "target_weight_max", "FLOAT"),
    ("workout_exercise", "target_duration_seconds", "INTEGER"),
    ("workout_exercise", "target_duration_seconds_max", "INTEGER"),
    ("session_exercise", "target_weight_max", "FLOAT"),
    ("session_exercise", "target_duration_seconds", "INTEGER"),
    ("session_exercise", "target_duration_seconds_max", "INTEGER"),
    ("sets", "rest_seconds", "INTEGER"),
    ("athlete_profile", "calorie_target", "INTEGER"),
    ("athlete_profile", "protein_target", "FLOAT"),
    # The DEFAULT backfills existing rows, so every plan that predates rolling
    # splits stays exactly what it already was: rigid.
    ("split", "mode", "VARCHAR NOT NULL DEFAULT 'rigid'"),
    ("user", "role", "VARCHAR NOT NULL DEFAULT 'user'"),
    ("workout_exercise", "superset_group", "VARCHAR"),
    ("session_exercise", "superset_group", "VARCHAR"),
    ("session_exercise", "rest_seconds", "INTEGER"),
    ("settings", "openai_api_key", "VARCHAR"),
    ("settings", "openai_model", "VARCHAR"),
]


def _ensure_columns() -> None:
    from sqlalchemy import inspect

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table, column, coltype in _ADDED_COLUMNS:
            if table not in existing_tables:
                continue
            cols = {c["name"] for c in inspector.get_columns(table)}
            if column not in cols:
                conn.exec_driver_sql(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")


def _enable_foreign_keys() -> None:
    """SQLite ignores foreign keys unless asked, per connection.

    Without this, `ON DELETE CASCADE` and `ON DELETE SET NULL` are decoration:
    the ORM cascades what it knows about and everything else is left dangling.
    """
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def _set_pragma(dbapi_connection, _record):  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def init_db() -> None:
    """Create all tables, then apply additive column migrations. TODO: Alembic."""
    from . import models  # noqa: F401  (ensure models are registered)

    _enable_foreign_keys()
    Base.metadata.create_all(bind=engine)
    _ensure_columns()

    # Rows belonging to accounts that no longer exist. Historic ones exist from
    # before both delete paths swept the same list, and leaving them is not
    # cosmetic: SQLite reuses user ids, so the next person to sign up could
    # inherit a stranger's training.
    from .accounts import sweep_orphans

    db = SessionLocal()
    try:
        sweep_orphans(db)
    finally:
        db.close()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
