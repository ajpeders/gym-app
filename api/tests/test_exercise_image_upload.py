"""Give a custom exercise a picture.

40% of the wger catalog has no image, and the importer creates a custom
exercise for anything it can't match — so the movements most likely to be
image-less are exactly the ones a user just brought in. Upload is scoped to
exercises the user owns: the shared catalog is never rewritten by one account,
same rule the import path already follows.
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


def test_a_catalog_exercise_cannot_be_overwritten(client, auth):
    """One account must not repaint the shared catalog for everybody."""
    headers, _, _ = auth
    global_id = client.get("/api/exercises?limit=1", headers=headers).json()["items"][0]["id"]

    assert _upload(client, headers, global_id).status_code == 404


def test_someone_elses_custom_exercise_is_untouchable(client, auth):
    import uuid

    headers, _, _ = auth
    other = client.post(
        "/api/auth/register",
        json={"email": f"img-{uuid.uuid4().hex[:8]}@example.com", "password": "secret123"},
    ).json()
    theirs = _custom(client, {"Authorization": f"Bearer {other['token']}"}, "Their Move")

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
