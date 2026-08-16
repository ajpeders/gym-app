"""Rolling splits — a rotation with no calendar in it.

A rigid split reads the date: days claim weekdays, a passed day is *missed*,
"done" resets on Sunday. That is wrong for anyone whose rest days land wherever
they land — the cycle drifts across week boundaries by design.

`split.mode` makes it an explicit choice rather than something you fake with
`floating` on every day, because it changes what "today", "missed" and "done"
each mean. These cover the rolling half; the rigid half is the existing
test_splits_today / test_splits_catchup suites, which must keep passing
unchanged since every existing split is rigid.
"""
from datetime import datetime, timedelta, timezone


def _make_split(client, headers, name="PPL", mode=None):
    body = {"name": name}
    if mode is not None:
        body["mode"] = mode
    r = client.post("/api/splits", headers=headers, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _add_day(client, headers, split_id, name, order, weekdays=()):
    return client.post(
        "/api/workouts",
        headers=headers,
        json={
            "name": name,
            "split_id": split_id,
            "weekdays": list(weekdays),
            "order": order,
            "exercises": [],
        },
    ).json()["id"]


def _activate(client, headers, split_id):
    client.patch(f"/api/splits/{split_id}", headers=headers, json={"is_active": True})


def _log(client, headers, workout_id, days_ago):
    when = datetime.now(timezone.utc) - timedelta(days=days_ago)
    r = client.post(
        "/api/sessions/log",
        headers=headers,
        json={
            "source_workout_id": workout_id,
            "started_at": when.replace(hour=12).isoformat(),
            "exercises": [],
        },
    )
    assert r.status_code == 201, r.text


def _ppl(client, headers):
    """An active rolling Push/Pull/Legs with no weekdays anywhere."""
    sid = _make_split(client, headers, mode="rolling")["id"]
    ids = [
        _add_day(client, headers, sid, name, order)
        for order, name in enumerate(("Push", "Pull", "Legs"))
    ]
    _activate(client, headers, sid)
    return sid, ids


def _today(client, headers):
    r = client.get("/api/splits/today", headers=headers)
    assert r.status_code == 200, r.text
    return {row["id"]: row for row in r.json()}


# --- the mode itself --------------------------------------------------------

def test_splits_are_rigid_unless_told_otherwise(client, auth):
    """Existing plans must not change under their owner."""
    headers, _, _ = auth
    assert _make_split(client, headers)["mode"] == "rigid"


def test_mode_can_be_set_at_creation_and_switched_later(client, auth):
    """Moving to rolling is what prompted this; moving back must be as easy."""
    headers, _, _ = auth
    split = _make_split(client, headers, mode="rolling")
    assert split["mode"] == "rolling"

    back = client.patch(
        f"/api/splits/{split['id']}", headers=headers, json={"mode": "rigid"}
    )
    assert back.status_code == 200
    assert back.json()["mode"] == "rigid"


def test_an_unknown_mode_is_rejected(client, auth):
    headers, _, _ = auth
    r = client.post("/api/splits", headers=headers, json={"name": "X", "mode": "weekly"})
    assert r.status_code == 422


# --- /today in rolling mode -------------------------------------------------

def test_a_fresh_rotation_starts_at_the_first_day(client, auth):
    headers, _, _ = auth
    _, (push, pull, legs) = _ppl(client, headers)

    rows = _today(client, headers)
    assert rows[push]["up_next"] is True
    assert rows[pull]["up_next"] is False
    assert rows[legs]["up_next"] is False


def test_every_day_of_the_rotation_is_offered(client, auth):
    """Rolling days have no weekdays, so the rigid filter would hide them all."""
    headers, _, _ = auth
    _, ids = _ppl(client, headers)
    assert set(_today(client, headers)) == set(ids)


def test_the_next_day_follows_what_was_logged(client, auth):
    headers, _, _ = auth
    _, (push, pull, legs) = _ppl(client, headers)
    _log(client, headers, push, days_ago=1)

    rows = _today(client, headers)
    assert rows[pull]["up_next"] is True
    assert rows[push]["done_this_cycle"] is True
    assert rows[pull]["done_this_cycle"] is False


def test_nothing_is_ever_missed_in_a_rolling_split(client, auth):
    """You cannot miss a day that was never scheduled for a date."""
    headers, _, _ = auth
    _, ids = _ppl(client, headers)
    _log(client, headers, ids[0], days_ago=9)

    assert all(row["missed"] is False for row in _today(client, headers).values())


def test_done_survives_a_week_boundary(client, auth):
    """The weekly reset is exactly what makes rigid wrong here: a cycle in
    progress across Sunday is still in progress."""
    headers, _, _ = auth
    _, (push, pull, legs) = _ppl(client, headers)
    _log(client, headers, push, days_ago=10)

    rows = _today(client, headers)
    assert rows[push]["done_this_cycle"] is True
    assert rows[pull]["up_next"] is True


def test_completing_the_rotation_starts_a_fresh_cycle(client, auth):
    headers, _, _ = auth
    _, (push, pull, legs) = _ppl(client, headers)
    _log(client, headers, push, days_ago=3)
    _log(client, headers, pull, days_ago=2)
    _log(client, headers, legs, days_ago=1)

    rows = _today(client, headers)
    assert rows[push]["up_next"] is True
    assert all(row["done_this_cycle"] is False for row in rows.values())


def test_rigid_splits_report_no_cycle_position(client, auth):
    """`up_next` must not start steering a plan that runs off the calendar."""
    headers, _, _ = auth
    today_weekday = (datetime.now(timezone.utc).weekday() + 1) % 7
    sid = _make_split(client, headers)["id"]
    wid = _add_day(client, headers, sid, "Today", 0, weekdays=[today_weekday])
    _activate(client, headers, sid)

    row = _today(client, headers)[wid]
    assert row["up_next"] is False
    assert row["scheduled_today"] is True


# --- /catchup in rolling mode -----------------------------------------------

def _catchup(client, headers, days=7):
    r = client.get(f"/api/splits/catchup?days={days}&tz_offset=0", headers=headers)
    assert r.status_code == 200, r.text
    return {row["date"]: row for row in r.json()}


def _date(days_ago):
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).date().isoformat()


def test_catchup_shows_what_was_up_next_on_each_day(client, auth):
    """Reading `weekdays` leaves this column empty for a rolling split, so the
    backlog view silently has nothing to compare against. What was due on an
    unlogged day is the day the cycle had reached by then."""
    headers, _, _ = auth
    _, (push, pull, legs) = _ppl(client, headers)
    _log(client, headers, push, days_ago=3)

    rows = _catchup(client, headers)
    # Before anything was logged the rotation was at its first day...
    assert [w["id"] for w in rows[_date(5)]["scheduled"]] == [push]
    # ...and once Push is in the log, Pull is what the following days were for.
    assert [w["id"] for w in rows[_date(2)]["scheduled"]] == [pull]
    assert rows[_date(2)]["logged"] is False


def test_catchup_credits_the_day_the_session_landed_on(client, auth):
    headers, _, _ = auth
    _, (push, pull, legs) = _ppl(client, headers)
    _log(client, headers, push, days_ago=3)

    row = _catchup(client, headers)[_date(3)]
    assert row["logged"] is True
    assert [w["id"] for w in row["scheduled"]] == [push]
