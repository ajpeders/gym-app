"""GET /splits/catchup — the recent past, day by day, so a backlog is visible.

`/today` only answers "what now". Catching up needs the opposite view: which
of the last N days had something scheduled, and which of those were actually
logged. Days are bucketed in the *client's* local time — sessions are stored
naive UTC, so a 7pm session would otherwise fall on the wrong calendar day for
anyone west of UTC.
"""
from datetime import datetime, timedelta, timezone


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


def _backdate(split_id, days):
    """Pretend the split has existed for `days`. Catch-up only looks back as
    far as the plan does, so a test about earlier days needs an older plan."""
    from app.db import SessionLocal
    from app.models import Split

    db = SessionLocal()
    try:
        split = db.get(Split, split_id)
        split.created_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
        db.commit()
    finally:
        db.close()


def _weekday_of(d: datetime) -> int:
    """0=Sun..6=Sat, matching Workout.weekdays."""
    return (d.weekday() + 1) % 7


def _catchup(client, headers, days=14, tz_offset=0):
    r = client.get(
        f"/api/splits/catchup?days={days}&tz_offset={tz_offset}", headers=headers
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_returns_a_row_per_day_most_recent_first(client, auth):
    headers, _, _ = auth
    rows = _catchup(client, headers, days=7)
    assert len(rows) == 7
    dates = [r["date"] for r in rows]
    assert dates == sorted(dates, reverse=True)
    today = datetime.now(timezone.utc).date().isoformat()
    assert dates[0] == today


def test_scheduled_days_are_attached_to_their_weekday(client, auth):
    headers, _, _ = auth
    sid = _make_split(client, headers)
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)
    wid = _add_day(client, headers, sid, "Pull", [_weekday_of(yesterday)])
    _activate(client, headers, sid)
    _backdate(sid, 30)

    rows = _catchup(client, headers, days=7)
    by_date = {r["date"]: r for r in rows}
    row = by_date[yesterday.date().isoformat()]
    assert [w["id"] for w in row["scheduled"]] == [wid]
    assert row["logged"] is False


def test_nothing_was_scheduled_before_the_plan_existed(client, auth):
    """Adopting a program must not invent a fortnight of missed days. A plan
    created this afternoon scheduled nothing yesterday, whatever its weekdays
    say — and a rotation that has never been trained had nothing due either."""
    headers, _, _ = auth
    sid = _make_split(client, headers)
    _add_day(client, headers, sid, "Pull", list(range(7)))  # every day
    _activate(client, headers, sid)

    rows = _catchup(client, headers, days=7)
    today = rows[0]
    assert today["scheduled"], "today is on the plan"
    assert all(r["scheduled"] == [] for r in rows[1:]), "the past is not"


def test_a_day_with_nothing_scheduled_is_a_rest_day(client, auth):
    """No flag on the model: a weekday with no day scheduled IS the rest day."""
    headers, _, _ = auth
    sid = _make_split(client, headers)
    # Pin the only workout to today, so every other day in the window is empty.
    _add_day(client, headers, sid, "Push", [_weekday_of(datetime.now(timezone.utc))])
    _activate(client, headers, sid)

    rows = _catchup(client, headers, days=7)
    rest = [r for r in rows if not r["scheduled"]]
    assert len(rest) == 6
    assert all(r["logged"] is False for r in rest)


def test_a_logged_session_marks_its_day(client, auth):
    headers, _, _ = auth
    two_days_ago = datetime.now(timezone.utc) - timedelta(days=2)
    r = client.post(
        "/api/sessions/log",
        headers=headers,
        json={"name": "Legs", "started_at": two_days_ago.isoformat(), "exercises": []},
    )
    assert r.status_code == 201, r.text

    rows = _catchup(client, headers, days=7)
    by_date = {x["date"]: x for x in rows}
    row = by_date[two_days_ago.date().isoformat()]
    assert row["logged"] is True
    assert [s["name"] for s in row["sessions"]] == ["Legs"]


def test_days_are_bucketed_in_the_clients_timezone(client, auth):
    """A session at 02:00 UTC belongs to the previous day for a UTC-6 client.

    tz_offset follows JS getTimezoneOffset(): minutes to ADD to local time to
    reach UTC, so UTC-6 sends 360.
    """
    headers, _, _ = auth
    # Pick a recent 02:00 UTC instant, which is 20:00 the day before at UTC-6.
    utc_moment = (datetime.now(timezone.utc) - timedelta(days=2)).replace(
        hour=2, minute=0, second=0, microsecond=0
    )
    r = client.post(
        "/api/sessions/log",
        headers=headers,
        json={"name": "Evening", "started_at": utc_moment.isoformat(), "exercises": []},
    )
    assert r.status_code == 201, r.text

    utc_rows = {x["date"]: x for x in _catchup(client, headers, days=7, tz_offset=0)}
    assert utc_rows[utc_moment.date().isoformat()]["logged"] is True

    local_rows = {x["date"]: x for x in _catchup(client, headers, days=7, tz_offset=360)}
    local_day = (utc_moment - timedelta(minutes=360)).date().isoformat()
    assert local_day != utc_moment.date().isoformat()
    assert local_rows[local_day]["logged"] is True
    assert local_rows[utc_moment.date().isoformat()]["logged"] is False


def test_only_the_owners_sessions_count(client, auth):
    import uuid

    headers, _, _ = auth
    other = client.post(
        "/api/auth/register",
        json={"email": f"other-{uuid.uuid4().hex[:8]}@example.com", "password": "secret123"},
    ).json()
    other_headers = {"Authorization": f"Bearer {other['token']}"}
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)
    client.post(
        "/api/sessions/log",
        headers=other_headers,
        json={"name": "Theirs", "started_at": yesterday.isoformat(), "exercises": []},
    )

    rows = {x["date"]: x for x in _catchup(client, headers, days=7)}
    assert rows[yesterday.date().isoformat()]["logged"] is False


def test_backfilling_a_missed_day_clears_it_from_today(client, auth):
    """The point of catching up: logging the makeup must retire the makeup.

    /splits/today decides `missed` from sessions linked to the plan day, so a
    backfilled session has to carry source_workout_id or the day stays missed
    forever.
    """
    headers, _, _ = auth
    now = datetime.now(timezone.utc)
    today_wd = _weekday_of(now)
    if today_wd == 0:
        return  # Sunday starts the week — nothing can be earlier
    sid = _make_split(client, headers)
    wid = _add_day(client, headers, sid, "Missed Pull", [today_wd - 1])
    _activate(client, headers, sid)

    before = {r["id"]: r for r in client.get("/api/splits/today", headers=headers).json()}
    assert before[wid]["missed"] is True

    yesterday = now - timedelta(days=1)
    r = client.post(
        "/api/sessions/log",
        headers=headers,
        json={
            "name": "Missed Pull",
            "started_at": yesterday.isoformat(),
            "source_workout_id": str(wid),
            "exercises": [],
        },
    )
    assert r.status_code == 201, r.text

    after = {x["id"]: x for x in client.get("/api/splits/today", headers=headers).json()}
    assert after.get(wid, {}).get("missed", False) is False
