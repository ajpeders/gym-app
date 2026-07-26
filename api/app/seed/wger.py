"""Import the wger exercise database (https://wger.de) into our own catalog.

wger's `exerciseinfo` API is CC-BY-SA 4.0. We pull it once and mirror everything
— data AND images — into our own DB + storage, so at runtime we never depend on
wger. Idempotent by external_id ("wger:<uuid>"); safe to re-run to update.

Standalone:
    python -m app.seed.wger            # import/update all
    python -m app.seed.wger --limit 5  # small slice for testing
"""
from __future__ import annotations

import logging
import os
import re
import sys

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SessionLocal, init_db
from ..models import Exercise
from .tracking import infer_tracking_type

logger = logging.getLogger("gym.seed.wger")

API = "https://wger.de/api/v2/exerciseinfo/"
ENGLISH_LANG_ID = 2  # wger language id for English
PAGE = 100

# Where mirrored exercise images live (served publicly by the API).
def _media_root() -> str:
    d = os.path.join(get_settings().data_dir.rstrip("/"), "exercise-media")
    os.makedirs(d, exist_ok=True)
    return d


_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t]+")


def _html_to_steps(html: str | None) -> list[str]:
    """wger descriptions are HTML. Strip to plain text and split into steps
    (list items / paragraphs / sentences), dropping empties."""
    if not html:
        return []
    # Turn block boundaries into newlines before stripping tags.
    text = re.sub(r"</(li|p|div|br)\s*>", "\n", html, flags=re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = _TAG_RE.sub("", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    steps = [_WS_RE.sub(" ", s).strip() for s in text.split("\n")]
    return [s for s in steps if s]


def _english(translations: list[dict]) -> dict | None:
    en = [t for t in translations if t.get("language") == ENGLISH_LANG_ID and t.get("name")]
    return en[0] if en else None


def _muscle_names(muscles: list[dict]) -> list[str]:
    out = []
    for m in muscles or []:
        out.append(m.get("name_en") or m.get("name") or "")
    return [x for x in out if x]


def fetch_page(client: httpx.Client, offset: int) -> dict:
    resp = client.get(
        API, params={"format": "json", "limit": PAGE, "offset": offset}, timeout=30
    )
    resp.raise_for_status()
    return resp.json()


def _download_images(client: httpx.Client, uuid: str, images: list[dict]) -> list[str]:
    """Mirror each image locally; return the list of relative URL paths the
    client resolves against the API base. Best-effort: a failed image is
    skipped, not fatal."""
    if not images:
        return []
    folder = os.path.join(_media_root(), uuid)
    os.makedirs(folder, exist_ok=True)
    urls: list[str] = []
    for idx, img in enumerate(images):
        # Prefer the 400x400 thumbnail — plenty for phone display and a fraction
        # of the multi-MB full-res original.
        thumbs = img.get("thumbnails") or {}
        src = thumbs.get("medium") or thumbs.get("small") or img.get("image")
        if not src:
            continue
        ext = os.path.splitext(src.split("?")[0])[1] or ".png"
        fname = f"{idx}{ext}"
        dest = os.path.join(folder, fname)
        rel = f"/api/exercise-media/{uuid}/{fname}"
        if os.path.isfile(dest) and os.path.getsize(dest) > 0:
            urls.append(rel)
            continue
        try:
            r = client.get(src, timeout=30, follow_redirects=True)
            r.raise_for_status()
            with open(dest, "wb") as fh:
                fh.write(r.content)
            urls.append(rel)
        except (httpx.HTTPError, OSError) as exc:
            logger.warning("image download failed for %s: %s", src, exc)
    return urls


def _map_exercise(client: httpx.Client, item: dict, download: bool) -> dict | None:
    tr = _english(item.get("translations") or [])
    if tr is None:
        return None  # no English name — skip
    uuid = item.get("uuid")
    equipment = item.get("equipment") or []
    lic = item.get("license") or {}
    return {
        "external_id": f"wger:{uuid}",
        "name": tr.get("name"),
        "category": (item.get("category") or {}).get("name"),
        "force": None,
        "level": None,
        "mechanic": None,
        "equipment": (equipment[0].get("name") if equipment else None),
        "tracking_type": infer_tracking_type(
            tr.get("name") or "", equipment[0].get("name") if equipment else None
        ),
        "primary_muscles": _muscle_names(item.get("muscles")),
        "secondary_muscles": _muscle_names(item.get("muscles_secondary")),
        "instructions": _html_to_steps(tr.get("description")),
        "images": _download_images(client, uuid, item.get("images") or []) if download else [],
        "license_short": lic.get("short_name"),
        "license_author": item.get("license_author"),
    }


def import_wger(db: Session, limit: int | None = None, download: bool = True) -> int:
    """Upsert wger exercises by external_id. Returns rows newly inserted;
    existing wger rows are refreshed (name/muscles/images) in place."""
    existing = {
        row[0]: row[1]
        for row in db.execute(
            select(Exercise.external_id, Exercise.id).where(
                Exercise.external_id.like("wger:%")
            )
        )
    }
    inserted = 0
    seen = 0
    with httpx.Client() as client:
        offset = 0
        while True:
            page = fetch_page(client, offset)
            results = page.get("results") or []
            if not results:
                break
            for item in results:
                mapped = _map_exercise(client, item, download)
                if mapped is None or not mapped["name"]:
                    continue
                ext = mapped["external_id"]
                fields = {k: v for k, v in mapped.items() if k not in ("license_short", "license_author")}
                if ext in existing:
                    ex = db.get(Exercise, existing[ext])
                    for k, v in fields.items():
                        setattr(ex, k, v)
                else:
                    db.add(Exercise(is_custom=False, owner_id=None, **fields))
                    existing[ext] = -1
                    inserted += 1
                seen += 1
                if limit and seen >= limit:
                    db.commit()
                    logger.info("wger import (limited): %s seen, %s new", seen, inserted)
                    return inserted
            db.commit()
            offset += PAGE
            if offset >= (page.get("count") or 0):
                break
    logger.info("wger import: %s seen, %s new", seen, inserted)
    return inserted


def backfill_free_db_images(db: Session, download: bool = True, fuzzy: bool = True) -> int:
    """Combine sources: give wger exercises that ship no image a fallback image
    from the public-domain free-exercise-db, matched by name. wger stays the
    catalog + data; free-exercise-db fills the image gaps. Mirrors those images
    locally too. Returns the number of exercises that gained an image.

    ``fuzzy`` also accepts subset-containment name matches (higher coverage, at
    the cost of an occasional near-miss image); off = exact stemmed-token only.
    """
    from ..ai.service import _norm
    from .exercises import IMAGE_BASE, fetch_dataset

    # Build free-exercise-db name-token -> image URLs index.
    fdb = []
    for item in fetch_dataset():
        name = item.get("name")
        imgs = item.get("images") or []
        if not name or not imgs:
            continue
        toks = frozenset(_norm(name))
        urls = [p if p.startswith("http") else IMAGE_BASE + p.lstrip("/") for p in imgs]
        fdb.append((toks, urls))

    def find(name: str) -> list[str]:
        t = frozenset(_norm(name))
        if not t:
            return []
        best: list[str] | None = None
        best_key: tuple = ()
        for toks, urls in fdb:
            if toks == t:
                return urls  # exact wins outright
            if not fuzzy or not toks:
                continue
            inter = len(t & toks)
            # one name's words fully contain the other's (matcher-v2 style)
            if inter == 0 or not (t <= toks or toks <= t):
                continue
            key = (inter, -abs(len(toks) - len(t)), -len(toks))
            if best is None or key > best_key:
                best, best_key = urls, key
        return best or []

    targets = db.execute(
        select(Exercise.id, Exercise.external_id, Exercise.name).where(
            Exercise.external_id.like("wger:%")
        )
    ).all()
    filled = 0
    with httpx.Client() as client:
        for ex_id, ext, name in targets:
            ex = db.get(Exercise, ex_id)
            if ex.images:  # already has an image
                continue
            urls = find(name)
            if not urls:
                continue
            uuid = ext.split("wger:", 1)[1]
            # Fake an images payload shaped like wger's so _download_images reuses.
            imgs = [{"image": u, "thumbnails": {}} for u in urls]
            local = _download_images(client, uuid, imgs) if download else []
            if local:
                ex.images = local
                filled += 1
        db.commit()
    logger.info("free-db image backfill: %s wger exercises gained an image", filled)
    return filled


def seed_if_empty(db: Session) -> int:
    """Seed the catalog from wger only if empty (fresh install). Errors
    propagate to the caller, which decides whether to swallow them."""
    count = db.scalar(select(func.count()).select_from(Exercise))
    if count and count > 0:
        logger.info("Exercises already present (%s rows); skipping wger seed", count)
        return 0
    logger.info("Seeding exercises from wger")
    n = import_wger(db, download=True)
    # Combine sources: fill wger's image gaps from free-exercise-db.
    backfill_free_db_images(db, download=True, fuzzy=True)
    return n


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    limit = None
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])
    init_db()
    db = SessionLocal()
    try:
        n = import_wger(db, limit=limit)
        print(f"Imported/updated wger exercises; {n} new")
    finally:
        db.close()


if __name__ == "__main__":
    main()
