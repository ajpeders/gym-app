"""GET /splits/today — what to train now, including makeup and floating days.

A rest day used to return an empty list, which left the home screen with
nothing to offer even when days scheduled earlier in the week were still
undone. Today's response also has to carry floating days, which the old
weekday filter silently dropped.
"""
from datetime import datetime, timezone


def _today_weekday() -> int:
    """0=Sun..6=Sat, matching Workout.weekdays and the route's own arithmetic."""
    return (datetime.now(timezone.utc).weekday() + 1) % 7


def _make_split(client, headers, name="Sched"):
    return client.post("/api/splits", headers=headers, json={"name": name}).json()["id"]


def _add_day(client, headers, split_id, name, weekdays, floating=False):
    return client.post(
        "/api/workouts",
        headers=headers,
        json={
            "name": name,
            "split_id": split_id,
            "weekdays": weekdays,
            "floating": floating,
            "exercises": [],
        },
    ).json()["id"]


def _activate(client, headers, split_id):
    client.patch(f"/api/splits/{split_id}", headers=headers, json={"is_active": True})


def test_todays_workout_is_flagged_scheduled_today(client, auth):
    headers, _, _ = auth
    sid = _make_split(client, headers)
    wid = _add_day(client, headers, sid, "Today", [_today_weekday()])
    _activate(client, headers, sid)

    rows = client.get("/api/splits/today", headers=headers).json()
    by_id = {r["id"]: r for r in rows}
    assert wid in by_id
    assert by_id[wid]["scheduled_today"] is True
    assert by_id[wid]["missed"] is False


def test_floating_days_are_returned(client, auth):
    """A floating day has no weekdays; the old filter made it invisible."""
    headers, _, _ = auth
    sid = _make_split(client, headers)
    wid = _add_day(client, headers, sid, "Anytime", [], floating=True)
    _activate(client, headers, sid)

    rows = client.get("/api/splits/today", headers=headers).json()
    by_id = {r["id"]: r for r in rows}
    assert wid in by_id
    assert by_id[wid]["floating"] is True
    assert by_id[wid]["scheduled_today"] is False
    assert by_id[wid]["missed"] is False


def test_earlier_undone_day_this_week_comes_back_as_missed(client, auth):
    """The makeup case: something scheduled earlier this week, never done."""
    headers, _, _ = auth
    today = _today_weekday()
    if today == 0:
        return  # Sunday starts the week — nothing can be earlier
    sid = _make_split(client, headers)
    wid = _add_day(client, headers, sid, "Earlier", [today - 1])
    _activate(client, headers, sid)

    rows = client.get("/api/splits/today", headers=headers).json()
    by_id = {r["id"]: r for r in rows}
    assert wid in by_id
    assert by_id[wid]["missed"] is True
    assert by_id[wid]["scheduled_today"] is False


def test_a_later_day_this_week_is_not_missed_yet(client, auth):
    headers, _, _ = auth
    today = _today_weekday()
    if today == 6:
        return  # Saturday ends the week — nothing can be later
    sid = _make_split(client, headers)
    wid = _add_day(client, headers, sid, "Later", [today + 1])
    _activate(client, headers, sid)

    rows = client.get("/api/splits/today", headers=headers).json()
    by_id = {r["id"]: r for r in rows}
    # Still upcoming, so it must not be offered as a makeup.
    assert by_id.get(wid, {}).get("missed", False) is False


def test_a_day_already_done_this_week_is_not_missed(client, auth):
    headers, _, _ = auth
    today = _today_weekday()
    if today == 0:
        return
    sid = _make_split(client, headers)
    wid = _add_day(client, headers, sid, "Done already", [today - 1])
    _activate(client, headers, sid)

    started = client.post(
        "/api/sessions/start", headers=headers, json={"workout_id": str(wid)}
    )
    assert started.status_code == 201, started.text

    rows = client.get("/api/splits/today", headers=headers).json()
    by_id = {r["id"]: r for r in rows}
    # Neither due today nor outstanding, so it should not be offered at all —
    # and certainly never as a makeup.
    assert by_id.get(wid, {}).get("missed", False) is False
