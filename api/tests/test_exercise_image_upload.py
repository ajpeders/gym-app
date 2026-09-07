"""Give an exercise a picture.

40% of the wger catalog has no image, and the importer creates a custom
exercise for anything it can't match — so the movements most likely to be
image-less are the ones a user just brought in *and* a large slice of the
catalog itself.

Both can be given a picture, but never the same way: your own exercise is
written to directly, while a shared catalog row gets a per-user override stored
beside it. One account must not repaint the catalog for every other, which is
the rule the import path already follows.
"""
from __future__ import annotations

import io

# A 1x1 PNG — smallest thing that is genuinely a PNG.
_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d494844520000000100000001080600000"
    "01f15c4890000000a49444154789c6360000002000100ffff03000006"
    "000557bfabd40000000049454e44ae426082"
)


def _custom(client, headers, name="Sled Drag"):
    return client.post("/api/exercises", headers=headers, json={"name": name}).json()


def _upload(client, headers, ex_id, data=_PNG, content_type="image/png"):
    return client.post(
        f"/api/exercises/{ex_id}/image",
        headers=headers,
        files={"file": ("shot.png", io.BytesIO(data), content_type)},
    )


def test_uploading_gives_the_exercise_an_image(client, auth):
    headers, _, _ = auth
    ex = _custom(client, headers)
    assert ex["images"] == []

    r = _upload(client, headers, ex["id"])
    assert r.status_code == 200, r.text
    assert len(r.json()["images"]) == 1


def test_the_image_is_served_back(client, auth):
    """It must land in the same media tree the catalog images use, so every
    existing <Image> renders it with no client change."""
    headers, _, _ = auth
    ex = _custom(client, headers)
    url = _upload(client, headers, ex["id"]).json()["images"][0]

    assert url.startswith("/api/exercise-media/")
    served = client.get(url)
    assert served.status_code == 200
    assert served.content == _PNG


def test_the_exercise_carries_the_image_when_listed_again(client, auth):
    headers, _, _ = auth
    ex = _custom(client, headers, "Yoke Carry")
    _upload(client, headers, ex["id"])

    fetched = client.get(f"/api/exercises/{ex['id']}", headers=headers).json()
    assert len(fetched["images"]) == 1


def test_uploading_again_replaces_rather_than_appends(client, auth):
    headers, _, _ = auth
    ex = _custom(client, headers, "Tire Flip")
    first = _upload(client, headers, ex["id"]).json()["images"][0]
    second = _upload(client, headers, ex["id"]).json()["images"]

    assert len(second) == 1 and second[0] != first


def test_deleting_the_image_returns_the_exercise_to_having_none(client, auth):
    headers, _, _ = auth
    ex = _custom(client, headers, "Farmer Walk")
    _upload(client, headers, ex["id"])

    r = client.delete(f"/api/exercises/{ex['id']}/image", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["images"] == []


def _other_account(client, label):
    import uuid

    other = client.post(
        "/api/auth/register",
        json={"email": f"{label}-{uuid.uuid4().hex[:8]}@example.com", "password": "secret123"},
    ).json()
    return {"Authorization": f"Bearer {other['token']}"}


def _catalog(client, headers, name="Barbell Bench Press"):
    return client.get("/api/exercises", headers=headers, params={"q": name}).json()["items"][0]


def test_your_picture_for_a_catalog_exercise_is_yours_alone(client, auth):
    """The point of the override: you see your shot, everyone else sees the
    catalog's. Uploading to the shared row itself would repaint it globally."""
    headers, _, _ = auth
    ex = _catalog(client, headers)
    stock = ex["images"]

    r = _upload(client, headers, ex["id"])
    assert r.status_code == 200, r.text
    mine = r.json()["images"]
    assert len(mine) == 1 and mine != stock

    assert client.get(f"/api/exercises/{ex['id']}", headers=headers).json()["images"] == mine
    theirs = _other_account(client, "img-other")
    assert client.get(f"/api/exercises/{ex['id']}", headers=theirs).json()["images"] == stock


def test_your_picture_follows_the_exercise_everywhere_it_appears(client, auth):
    """An exercise is serialized from a dozen places; a picture that only shows
    on the exercise screen is the bug this replaced."""
    headers, _, _ = auth
    ex = _catalog(client, headers, "Barbell Squat")
    mine = _upload(client, headers, ex["id"]).json()["images"]

    workout = client.post(
        "/api/workouts",
        headers=headers,
        json={"name": "Legs", "exercises": [{"exercise_id": ex["id"], "order": 0}]},
    ).json()
    assert workout["exercises"][0]["exercise"]["images"] == mine

    session = client.post(
        "/api/sessions/start", headers=headers, json={"workout_id": workout["id"]}
    ).json()
    assert session["exercises"][0]["exercise"]["images"] == mine


def test_replacing_your_picture_for_a_catalog_exercise(client, auth):
    headers, _, _ = auth
    ex = _catalog(client, headers, "Barbell Bench Press")
    first = _upload(client, headers, ex["id"]).json()["images"][0]
    second = _upload(client, headers, ex["id"]).json()["images"]
    assert len(second) == 1 and second[0] != first


def test_removing_your_picture_restores_the_catalog_one(client, auth):
    # An override sits on top of the shared image; taking it off must not leave
    # the exercise blank.
    headers, _, _ = auth
    ex = _catalog(client, headers, "Barbell Bench Press")
    stock = ex["images"]
    _upload(client, headers, ex["id"])

    r = client.delete(f"/api/exercises/{ex['id']}/image", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["images"] == stock


def test_removing_a_picture_you_never_uploaded_is_a_404(client, auth):
    headers, _, _ = auth
    ex = _catalog(client, headers, "Barbell Squat")
    assert client.delete(f"/api/exercises/{ex['id']}/image", headers=headers).status_code == 404


def test_someone_elses_custom_exercise_is_untouchable(client, auth):
    # Not even as an override — an exercise you can't see, you can't annotate.
    headers, _, _ = auth
    theirs = _custom(client, _other_account(client, "img"), "Their Move")

    assert _upload(client, headers, theirs["id"]).status_code == 404


def test_a_non_image_upload_is_rejected(client, auth):
    headers, _, _ = auth
    ex = _custom(client, headers, "Bad Upload")

    r = _upload(client, headers, ex["id"], data=b"#!/bin/sh\n", content_type="text/x-sh")
    assert r.status_code == 400


def test_an_empty_file_is_rejected(client, auth):
    headers, _, _ = auth
    ex = _custom(client, headers, "Empty Upload")

    assert _upload(client, headers, ex["id"], data=b"").status_code == 400


def test_your_catalog_pictures_are_in_the_export(client, auth):
    # Symmetry with `delete_me`: anything the account owns, you can take with
    # you before you delete it.
    headers, _, _ = auth
    ex = _catalog(client, headers, "Barbell Squat")
    mine = _upload(client, headers, ex["id"]).json()["images"]

    exported = client.get("/api/auth/me/export", headers=headers).json()
    assert exported["exercise_images"] == [
        {"exercise_id": ex["id"], "images": mine, "created_at": exported["exercise_images"][0]["created_at"]}
    ]


def test_deleting_the_account_takes_your_catalog_pictures_with_it(client, auth):
    headers, user, _ = auth
    ex = _catalog(client, headers, "Barbell Bench Press")
    _upload(client, headers, ex["id"])

    assert client.delete("/api/auth/me", headers=headers).status_code == 204

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ExerciseImageOverride

    db = SessionLocal()
    try:
        # Scoped to this account: the test DB is shared across the session, so
        # a global count would pick up other tests' rows.
        left = db.scalars(
            select(ExerciseImageOverride).where(
                ExerciseImageOverride.owner_id == int(user["id"])
            )
        ).all()
        assert left == []
    finally:
        db.close()


def test_image_is_yours_distinguishes_your_picture_from_the_catalogs(client, auth):
    """The client can't tell an override from a catalog image by looking at the
    url, and it has to: removing yours restores theirs, it doesn't blank it."""
    headers, _, _ = auth
    ex = _catalog(client, headers, "Barbell Squat")
    assert ex["image_is_yours"] is False

    _upload(client, headers, ex["id"])
    assert client.get(f"/api/exercises/{ex['id']}", headers=headers).json()["image_is_yours"] is True
    # Still the catalog's, as far as anyone else is concerned.
    theirs = _other_account(client, "img-yours")
    assert client.get(f"/api/exercises/{ex['id']}", headers=theirs).json()["image_is_yours"] is False


def test_a_custom_exercise_with_a_photo_counts_as_yours(client, auth):
    headers, _, _ = auth
    ex = _custom(client, headers, "Zercher Carry")
    assert ex["image_is_yours"] is False
    assert _upload(client, headers, ex["id"]).json()["image_is_yours"] is True
