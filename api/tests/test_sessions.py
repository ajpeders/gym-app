"""Session lifecycle: create, add exercise, log set, fetch history; start-from-plan."""


def _first_exercise_id(client, headers):
    items = client.get("/api/exercises", headers=headers).json()["items"]
    return items[0]["id"]


def test_session_full_flow(client, auth):
    headers, _, _ = auth
    ex_id = _first_exercise_id(client, headers)

    # Start an empty session.
    w = client.post("/api/sessions", headers=headers, json={"name": "Push Day"})
    assert w.status_code == 201, w.text
    session = w.json()
    assert session["finished_at"] is None
    sid = session["id"]

    # Add an exercise.
    se = client.post(
        f"/api/sessions/{sid}/exercises", headers=headers, json={"exercise_id": ex_id}
    )
    assert se.status_code == 201, se.text
    se_id = se.json()["id"]
    assert se.json()["order"] == 0

    # Log two sets.
    s1 = client.post(
        f"/api/sessions/{sid}/exercises/{se_id}/sets",
        headers=headers,
        json={"reps": 10, "weight": 60.0},
    )
    assert s1.status_code == 201, s1.text
    assert s1.json()["set_number"] == 1
    assert s1.json()["set_type"] == "working"

    s2 = client.post(
        f"/api/sessions/{sid}/exercises/{se_id}/sets",
        headers=headers,
        json={"reps": 8, "weight": 65.0, "rpe": 8.5, "set_type": "working"},
    )
    assert s2.status_code == 201
    assert s2.json()["set_number"] == 2
    set_id = s2.json()["id"]

    # Patch a set.
    patched = client.patch(
        f"/api/sessions/{sid}/exercises/{se_id}/sets/{set_id}",
        headers=headers,
        json={"reps": 9},
    )
    assert patched.status_code == 200
    assert patched.json()["reps"] == 9

    # Finish the session.
    fin = client.post(f"/api/sessions/{sid}/finish", headers=headers)
    assert fin.status_code == 200
    assert fin.json()["finished_at"] is not None

    # History contains it with nested exercises + sets.
    hist = client.get("/api/sessions", headers=headers)
    assert hist.status_code == 200
    body = hist.json()
    assert body["total"] >= 1
    found = next(w for w in body["items"] if w["id"] == sid)
    assert len(found["exercises"]) == 1
    assert len(found["exercises"][0]["sets"]) == 2

    # Single fetch.
    one = client.get(f"/api/sessions/{sid}", headers=headers)
    assert one.status_code == 200
    assert one.json()["exercises"][0]["exercise"]["id"] == ex_id

    # Delete a set.
    d = client.delete(
        f"/api/sessions/{sid}/exercises/{se_id}/sets/{set_id}", headers=headers
    )
    assert d.status_code == 204


def test_start_from_workout_prefills(client, auth):
    headers, _, _ = auth
    ex_id = _first_exercise_id(client, headers)

    workout = client.post(
        "/api/workouts",
        headers=headers,
        json={
            "name": "Leg Day",
            "notes": "heavy",
            "exercises": [
                {
                    "exercise_id": ex_id,
                    "order": 0,
                    "target_sets": 3,
                    "target_reps": 5,
                    "target_weight": 100,
                    "target_weight_max": 110,
                    "target_duration_seconds": 20,
                    "target_duration_seconds_max": 60,
                    "rest_seconds": 180,
                }
            ],
        },
    )
    assert workout.status_code == 201, workout.text
    wid = workout.json()["id"]
    assert len(workout.json()["exercises"]) == 1

    started = client.post(
        "/api/sessions/start", headers=headers, json={"workout_id": wid}
    )
    assert started.status_code == 201, started.text
    data = started.json()
    assert data["source_workout_id"] == wid
    assert data["name"] == "Leg Day"
    assert len(data["exercises"]) == 1
    exercise = data["exercises"][0]
    assert exercise["exercise_id"] == ex_id
    assert exercise["target_weight"] == 100
    assert exercise["target_weight_max"] == 110
    assert exercise["target_duration_seconds"] == 20
    assert exercise["target_duration_seconds_max"] == 60


def test_session_isolation_between_users(client, auth):
    headers, _, _ = auth
    w = client.post("/api/sessions", headers=headers, json={"name": "Private"})
    sid = w.json()["id"]

    import uuid

    other = client.post(
        "/api/auth/register",
        json={"email": f"iso-{uuid.uuid4().hex[:6]}@x.com", "password": "abcdef"},
    ).json()
    oh = {"Authorization": f"Bearer {other['token']}"}
    assert client.get(f"/api/sessions/{sid}", headers=oh).status_code == 404
    assert client.get("/api/sessions", headers=oh).json()["total"] == 0


def test_settings_and_stats(client, auth):
    headers, _, _ = auth

    s = client.get("/api/settings", headers=headers)
    assert s.status_code == 200
    assert s.json()["units"] == "kg"

    upd = client.patch(
        "/api/settings",
        headers=headers,
        json={"units": "lb", "feature_flags": {"in_set_prompts": True}},
    )
    assert upd.status_code == 200
    assert upd.json()["units"] == "lb"
    # Merge preserves existing flags.
    assert upd.json()["feature_flags"]["quick_buttons"] is True
    assert upd.json()["feature_flags"]["in_set_prompts"] is True

    stats = client.get("/api/stats/summary", headers=headers)
    assert stats.status_code == 200
    payload = stats.json()
    assert "total_workouts" in payload
    assert "this_week" in payload
    assert isinstance(payload["recent_prs"], list)
    assert isinstance(payload["volume_by_week"], list)


def test_openai_provider_settings_are_write_only(client, auth):
    headers, _, _ = auth

    upd = client.patch(
        "/api/settings",
        headers=headers,
        json={
            "ai_provider": "openai",
            "openai_api_key": "sk-proj-secret-test",
            "openai_model": "gpt-5.6-luna",
        },
    )
    assert upd.status_code == 200, upd.text
    body = upd.json()
    assert body["ai_provider"] == "openai"
    assert body["openai_model"] == "gpt-5.6-luna"
    assert "openai_api_key" not in body

    providers = client.get("/api/ai/providers", headers=headers)
    assert providers.status_code == 200, providers.text
    payload = providers.json()
    assert payload["provider"] == "openai"
    assert payload["configured"] is True
    assert payload["providers"]["openai"]["configured"] is True
    assert payload["providers"]["openai"]["model"] == "gpt-5.6-luna"


def test_check_model_scores_fake_tool_probe(client, auth, monkeypatch):
    from companion import Completion, ToolCall

    from app.ai import service

    headers, _, _ = auth

    class GoodProvider:
        name = "ollama"
        model = "probe-good"

        async def complete_text(self, *, system, messages, tools=None):
            return Completion(
                tool_calls=[
                    ToolCall(
                        id="1",
                        name="search_exercise",
                        arguments={"query": "squat"},
                    ),
                    ToolCall(
                        id="2",
                        name="log_sets",
                        arguments={
                            "exercise_id": 42,
                            "sets": [
                                {"reps": 5, "weight": 100},
                                {"reps": 5, "weight": 100},
                                {"reps": 5, "weight": 100},
                            ],
                        },
                    ),
                ]
            )

    monkeypatch.setattr(service, "_resolve", lambda db, user: (GoodProvider(), "kg"))

    res = client.post("/api/ai/check-model", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["verdict"] == "recommended"
    assert body["summary"] == "Passed 4/4 spotter capability checks."
    assert all(check["passed"] for check in body["checks"])


def test_metrics_crud(client, auth):
    headers, _, _ = auth
    created = client.post(
        "/api/metrics",
        headers=headers,
        json={"weight": 80.5, "body_fat": 15.0, "measurements": {"waist": 84}},
    )
    assert created.status_code == 201, created.text
    mid = created.json()["id"]

    listed = client.get("/api/metrics", headers=headers)
    assert listed.status_code == 200
    assert any(m["id"] == mid for m in listed.json())

    assert client.delete(f"/api/metrics/{mid}", headers=headers).status_code == 204
