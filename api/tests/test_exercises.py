"""Exercise listing, filtering, and custom CRUD."""


def test_list_exercises_includes_seeded(client, auth):
    headers, _, _ = auth
    resp = client.get("/api/exercises", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 2
    names = {e["name"] for e in data["items"]}
    assert "Barbell Bench Press" in names


def test_filter_by_query_and_muscle(client, auth):
    headers, _, _ = auth
    resp = client.get("/api/exercises?q=squat", headers=headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert all("squat" in e["name"].lower() for e in items)
    assert any(e["name"] == "Barbell Squat" for e in items)

    resp = client.get("/api/exercises?muscle=chest", headers=headers)
    assert resp.status_code == 200
    chest_names = {e["name"] for e in resp.json()["items"]}
    assert "Barbell Bench Press" in chest_names


def test_custom_exercise_crud_and_isolation(client, auth):
    headers, _, _ = auth
    create = client.post(
        "/api/exercises",
        headers=headers,
        json={
            "name": "My Cable Fly",
            "category": "strength",
            "equipment": "cable",
            "primary_muscles": ["chest"],
            "secondary_muscles": [],
            "instructions": ["Fly the cables."],
        },
    )
    assert create.status_code == 201, create.text
    ex = create.json()
    assert ex["is_custom"] is True
    assert ex["owner_id"] is not None
    ex_id = ex["id"]

    # Patch it.
    patched = client.patch(
        f"/api/exercises/{ex_id}", headers=headers, json={"name": "My Cable Flye"}
    )
    assert patched.status_code == 200
    assert patched.json()["name"] == "My Cable Flye"

    # A different user must not see it.
    import uuid

    other = client.post(
        "/api/auth/register",
        json={"email": f"o-{uuid.uuid4().hex[:6]}@x.com", "password": "abcdef"},
    ).json()
    other_headers = {"Authorization": f"Bearer {other['token']}"}
    assert client.get(f"/api/exercises/{ex_id}", headers=other_headers).status_code == 404
    # And cannot delete it.
    assert client.delete(f"/api/exercises/{ex_id}", headers=other_headers).status_code == 404

    # Owner can delete.
    assert client.delete(f"/api/exercises/{ex_id}", headers=headers).status_code == 204
    assert client.get(f"/api/exercises/{ex_id}", headers=headers).status_code == 404


def test_cannot_edit_global_exercise(client, auth):
    headers, _, _ = auth
    items = client.get("/api/exercises", headers=headers).json()["items"]
    global_ex = next(e for e in items if not e["is_custom"])
    resp = client.patch(
        f"/api/exercises/{global_ex['id']}", headers=headers, json={"name": "Hacked"}
    )
    assert resp.status_code == 404
