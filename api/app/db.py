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
    ("settings", "ollama_url", "VARCHAR"),
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


def init_db() -> None:
    """Create all tables, then apply additive column migrations. TODO: Alembic."""
    from . import models  # noqa: F401  (ensure models are registered)

    Base.metadata.create_all(bind=engine)
    _ensure_columns()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
