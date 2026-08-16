"""Bringing a training history in from Hevy or Strong, and taking it out again.

The point of the import moat is that it's trivial to bring a whole training
life *in*. Both apps export CSV, both use different column names, and neither
is going to change for us — so this sniffs the format from the header row and
normalises. No model involved: a CSV is structured data, and asking an LLM to
read one would be slower, costlier and less reliable than reading it.

Sessions are grouped by their start time, exercises resolved through the same
catalog matcher as everything else, and anything unmatched is reported rather
than dropped.
"""
from __future__ import annotations

from app.csv_io import detect_format, parse_rows, sessions_from_rows

HEVY = (
    "title,start_time,end_time,exercise_title,set_index,set_type,weight_kg,reps,rpe\n"
    '"Push","2026-08-01 09:00:00","2026-08-01 10:00:00","Bench Press",0,"normal",60,8,\n'
    '"Push","2026-08-01 09:00:00","2026-08-01 10:00:00","Bench Press",1,"normal",60,7,8\n'
    '"Push","2026-08-01 09:00:00","2026-08-01 10:00:00","Overhead Press",0,"warmup",20,10,\n'
    '"Legs","2026-08-03 09:00:00","2026-08-03 10:00:00","Squat",0,"normal",100,5,\n'
)

STRONG = (
    "Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Notes,RPE\n"
    '"2026-08-01 09:00:00","Push","Bench Press",1,60,8,"felt good",\n'
    '"2026-08-01 09:00:00","Push","Bench Press",2,60,7,"",8\n'
    '"2026-08-03 09:00:00","Legs","Squat",1,100,5,"",\n'
)


def test_the_format_is_sniffed_from_the_header() -> None:
    assert detect_format(HEVY) == "hevy"
    assert detect_format(STRONG) == "strong"


def test_something_that_is_not_a_training_export_is_refused() -> None:
    assert detect_format("name,email\nalex,a@b.c\n") is None
    assert detect_format("") is None


def test_hevy_rows_are_normalised() -> None:
    rows = parse_rows(HEVY)
    assert len(rows) == 4
    first = rows[0]
    assert first["workout"] == "Push"
    assert first["exercise"] == "Bench Press"
    assert first["weight"] == 60
    assert first["reps"] == 8
    assert first["started_at"].startswith("2026-08-01")


def test_strong_rows_are_normalised_the_same_way(tmp_path) -> None:
    rows = parse_rows(STRONG)
    assert [r["exercise"] for r in rows] == ["Bench Press", "Bench Press", "Squat"]
    assert rows[0]["notes"] == "felt good"
    assert rows[1]["rpe"] == 8


def test_a_warmup_stays_a_warmup() -> None:
    """Importing warmups as working sets would inflate every volume number."""
    rows = parse_rows(HEVY)
    assert rows[2]["set_type"] == "warmup"
    assert rows[0]["set_type"] == "working"


def test_rows_group_into_sessions_by_start_time() -> None:
    sessions = sessions_from_rows(parse_rows(HEVY))
    assert [s["name"] for s in sessions] == ["Push", "Legs"]
    assert len(sessions[0]["exercises"]) == 2
    assert len(sessions[0]["exercises"][0]["sets"]) == 2


def test_a_session_keeps_the_order_the_file_had() -> None:
    sessions = sessions_from_rows(parse_rows(HEVY))
    assert [e["exercise"] for e in sessions[0]["exercises"]] == ["Bench Press", "Overhead Press"]


def test_a_row_with_no_reps_or_weight_is_skipped_not_imported_as_zero() -> None:
    csv = (
        "Date,Workout Name,Exercise Name,Set Order,Weight,Reps\n"
        '"2026-08-01 09:00:00","Push","Bench Press",1,,\n'
        '"2026-08-01 09:00:00","Push","Bench Press",2,60,8\n'
    )
    sessions = sessions_from_rows(parse_rows(csv))
    assert len(sessions[0]["exercises"][0]["sets"]) == 1


def test_an_empty_file_produces_no_sessions_rather_than_an_error() -> None:
    assert sessions_from_rows(parse_rows("Date,Workout Name,Exercise Name\n")) == []


# --- the endpoints ---------------------------------------------------------

STRONG_WITH_KNOWN_LIFTS = (
    "Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Notes,RPE\n"
    '"2026-08-01 09:00:00","Push","Barbell Bench Press",1,60,8,"",\n'
    '"2026-08-01 09:00:00","Push","Barbell Bench Press",2,60,7,"",8\n'
    '"2026-08-03 09:00:00","Legs","Barbell Squat",1,100,5,"",\n'
    '"2026-08-03 09:00:00","Legs","Zercher Widget",1,100,5,"",\n'
)


def test_a_history_imports_into_real_sessions(client, auth):
    headers, _, _ = auth
    r = client.post(
        "/api/sessions/import-csv", headers=headers, json={"csv": STRONG_WITH_KNOWN_LIFTS}
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["format"] == "strong"
    assert body["sessions_created"] == 2
    assert body["sets_imported"] == 3

    sessions = client.get("/api/sessions", headers=headers).json()["items"]
    assert [s["name"] for s in sessions] == ["Legs", "Push"]  # newest first


def test_imported_sessions_keep_the_dates_they_happened_on(client, auth):
    """A year of history all stamped "today" is worse than no history."""
    headers, _, _ = auth
    client.post("/api/sessions/import-csv", headers=headers, json={"csv": STRONG_WITH_KNOWN_LIFTS})
    sessions = client.get("/api/sessions", headers=headers).json()["items"]
    assert all(s["started_at"].startswith("2026-08-0") for s in sessions)
    assert all(s["finished_at"] is not None for s in sessions)


def test_a_movement_the_catalog_lacks_is_reported(client, auth):
    headers, _, _ = auth
    body = client.post(
        "/api/sessions/import-csv", headers=headers, json={"csv": STRONG_WITH_KNOWN_LIFTS}
    ).json()
    assert body["unmatched"] == ["Zercher Widget"]


def test_something_that_is_not_an_export_is_refused_with_an_explanation(client, auth):
    headers, _, _ = auth
    r = client.post("/api/sessions/import-csv", headers=headers, json={"csv": "a,b\n1,2\n"})
    assert r.status_code == 422
    assert "hevy" in r.json()["detail"].lower()


def test_the_export_can_be_imported_back(client, auth, auth2):
    """An export you can't re-import is a screenshot with extra steps."""
    headers, _, _ = auth
    other_headers, _, _ = auth2
    client.post("/api/sessions/import-csv", headers=headers, json={"csv": STRONG_WITH_KNOWN_LIFTS})

    exported = client.get("/api/sessions/export.csv", headers=headers)
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("text/csv")

    # Round-trip into a second account: same sessions, same sets.
    result = client.post(
        "/api/sessions/import-csv", headers=other_headers, json={"csv": exported.text}
    ).json()
    assert result["sessions_created"] == 2
    assert result["sets_imported"] == 3


def test_the_export_only_contains_your_own_training(client, auth, auth2):
    headers, _, _ = auth
    other_headers, _, _ = auth2
    client.post("/api/sessions/import-csv", headers=headers, json={"csv": STRONG_WITH_KNOWN_LIFTS})

    assert "Barbell Bench Press" not in client.get(
        "/api/sessions/export.csv", headers=other_headers
    ).text
