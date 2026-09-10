"""Sets out of a sentence, without a model.

"bench 3x8 @60" is not natural language, it is notation, and a gym log is
mostly notation. Reading it deterministically means voice and text logging
work on an account with no AI provider, give the same answer every time, and
answer in milliseconds. The model stays as the fallback for prose the rules
don't recognise.
"""
from app.set_parse import parse_days_text, parse_sets_text


def _one(text):
    items = parse_sets_text(text)
    assert len(items) == 1, items
    return items[0]


def test_sets_by_reps_at_a_load():
    item = _one("bench 3x8 @60")
    assert item["exercise"] == "bench"
    assert [(s["reps"], s["weight"]) for s in item["sets"]] == [(8, 60.0)] * 3


def test_at_and_units_are_optional_spellings():
    for text in ("bench 3x8 at 60kg", "bench 3 x 8 @ 60 kg", "bench 3×8@60", "bench 3*8 60kg"):
        item = _one(text)
        assert [(s["reps"], s["weight"]) for s in item["sets"]] == [(8, 60.0)] * 3, text


def test_a_rep_list_is_one_set_per_entry():
    item = _one("squats 5,5,5 @100")
    assert item["exercise"] == "squats"
    assert [(s["reps"], s["weight"]) for s in item["sets"]] == [(5, 100.0)] * 3


def test_load_reps_pairs_from_notes():
    item = _one("Bench press — 95 10, 90 11, 85 12")
    assert item["exercise"] == "Bench press"
    assert [(s["reps"], s["weight"]) for s in item["sets"]] == [(10, 95.0), (11, 90.0), (12, 85.0)]


def test_bodyweight_has_no_load():
    item = _one("pull ups 3x8")
    assert [(s["reps"], s["weight"]) for s in item["sets"]] == [(8, None)] * 3


def test_two_exercises_joined_by_then():
    items = parse_sets_text("lat pulldown 3x10 at 40kg then hammer curls 3x12 @12.5")
    assert [i["exercise"] for i in items] == ["lat pulldown", "hammer curls"]
    assert items[1]["sets"][0]["weight"] == 12.5


def test_one_exercise_per_line():
    items = parse_sets_text("bench 3x8 @60\nrows 3x10 @40\n")
    assert [i["exercise"] for i in items] == ["bench", "rows"]


def test_commentary_becomes_a_note_not_a_set():
    item = _one("bench 3x8 @60, last set hard")
    assert len(item["sets"]) == 3
    assert item["notes"] == "last set hard"


def test_rpe_is_read_when_given():
    item = _one("deadlift 1x5 @140 rpe 9")
    assert item["sets"][0]["rpe"] == 9.0


def test_spoken_numbers():
    """What a recogniser hands back for "bench three by eight at sixty"."""
    item = _one("bench three by eight at sixty")
    assert item["exercise"] == "bench"
    assert [(s["reps"], s["weight"]) for s in item["sets"]] == [(8, 60.0)] * 3
    item = _one("squat five sets of five at one hundred and twenty")
    assert [(s["reps"], s["weight"]) for s in item["sets"]] == [(5, 120.0)] * 5


def test_sets_of_is_the_same_as_x():
    item = _one("ohp 4 sets of 6 at 40")
    assert [(s["reps"], s["weight"]) for s in item["sets"]] == [(6, 40.0)] * 4


def test_prose_without_notation_is_not_guessed():
    assert parse_sets_text("did some bench and it went ok") == []
    assert parse_sets_text("") == []


def test_days_split_on_headers():
    text = """Thu - Push
Bench 95 10, 90 11
Incline DB press 3x10 @30

Sat
Lat pulldown 3x10 @100"""
    days = parse_days_text(text)
    assert [d["day"] for d in days] == ["Thu - Push", "Sat"]
    assert [i["exercise"] for i in days[0]["exercises"]] == ["Bench", "Incline DB press"]
    assert days[1]["exercises"][0]["sets"][0]["weight"] == 100.0


def test_a_paste_with_no_header_is_one_unnamed_day():
    days = parse_days_text("bench 3x8 @60\nrows 3x10 @40")
    assert len(days) == 1
    assert days[0]["day"] is None
    assert len(days[0]["exercises"]) == 2


# --- the endpoint: rules first, model only for prose ------------------------

def test_notation_is_read_with_no_ai_provider_at_all(client, auth):
    headers, _, _ = auth
    r = client.post("/api/ai/parse-sets", headers=headers, json={"text": "barbell bench press 3x8 @60"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["provider"] == "local"
    assert body["units"] == "kg"
    assert len(body["items"]) == 1
    item = body["items"][0]
    assert item["matched_name"] == "Barbell Bench Press"
    assert [(s["reps"], s["weight"]) for s in item["sets"]] == [(8, 60.0)] * 3


def test_prose_still_needs_the_model(client, auth):
    headers, _, _ = auth
    r = client.post("/api/ai/parse-sets", headers=headers, json={"text": "did a bit of benching, felt fine"})
    assert r.status_code == 502
    assert "set up" in r.json()["detail"].lower()


def test_days_are_read_with_no_ai_provider(client, auth):
    headers, _, _ = auth
    text = "Thu - Push\nbarbell bench press 3x8 @60\n\nSat\nbarbell squat 5x5 @100"
    r = client.post("/api/ai/parse-days", headers=headers, json={"text": text})
    assert r.status_code == 200, r.text
    days = r.json()["days"]
    assert [d["day"] for d in days] == ["Thu - Push", "Sat"]
    assert days[1]["items"][0]["matched_name"] == "Barbell Squat"
