"""Auth flow: register, login, me, and unauthorized access."""


def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_register_login_me(client):
    email = "flow@example.com"
    reg = client.post(
        "/api/auth/register",
        json={"email": email, "password": "hunter2!", "display_name": "Flow"},
    )
    assert reg.status_code == 201, reg.text
    body = reg.json()
    assert body["user"]["email"] == email
    assert body["user"]["display_name"] == "Flow"
    assert body["token"]

    login = client.post(
        "/api/auth/login", json={"email": email, "password": "hunter2!"}
    )
    assert login.status_code == 200, login.text
    token = login.json()["token"]

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["email"] == email


def test_duplicate_register_conflicts(client):
    payload = {"email": "dup@example.com", "password": "abcdef", "display_name": "D"}
    assert client.post("/api/auth/register", json=payload).status_code == 201
    assert client.post("/api/auth/register", json=payload).status_code == 409


def test_login_wrong_password(client):
    client.post(
        "/api/auth/register",
        json={"email": "wp@example.com", "password": "correct1", "display_name": ""},
    )
    bad = client.post(
        "/api/auth/login", json={"email": "wp@example.com", "password": "nope"}
    )
    assert bad.status_code == 401


def test_me_requires_auth(client):
    assert client.get("/api/auth/me").status_code == 401


def test_simple_username_and_short_password(client):
    """`/register` enforces an email shape on signup (GYM-03); passwords stay
    minimal for the LAN instance. The same shape goes for `/login`, which
    never tells a caller whether the email shape was the rejection reason.
    """
    bad = client.post("/api/auth/register", json={"email": "alex", "password": "1234"})
    assert bad.status_code == 422, bad.text
    assert "email" in bad.text.lower()

    good = client.post(
        "/api/auth/register", json={"email": "alex@example.com", "password": "1234"}
    )
    assert good.status_code == 201, good.text

    login = client.post(
        "/api/auth/login", json={"email": "alex@example.com", "password": "1234"}
    )
    assert login.status_code == 200, login.text


def test_delete_me_removes_account_and_owned_data(client):
    reg = client.post(
        "/api/auth/register", json={"email": "gone@example.com", "password": "abcdef"}
    )
    headers = {"Authorization": f"Bearer {reg.json()['token']}"}
    # Owned data that must be swept.
    split = client.post("/api/splits", headers=headers, json={"name": "S"}).json()
    client.post(
        "/api/workouts",
        headers=headers,
        json={"name": "W", "split_id": split["id"], "weekdays": [1], "exercises": []},
    )

    assert client.delete("/api/auth/me", headers=headers).status_code == 204
    # Token no longer resolves to a user.
    assert client.get("/api/auth/me", headers=headers).status_code == 401
    # Credentials are gone.
    assert (
        client.post(
            "/api/auth/login", json={"email": "gone@example.com", "password": "abcdef"}
        ).status_code
        == 401
    )
