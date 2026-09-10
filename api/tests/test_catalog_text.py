from app.catalog_text import clean_instructions


def test_the_marketing_paragraph_and_its_label_go():
    steps = [
        "The Step Jack is a low-impact plyometric-style move that provides cardiovascular benefits without the joint stress of jumping. It works the entire body, specifically targeting the legs, core, and shoulders. This move is ideal for beginners.",
        "Notes (Instructions):",
        "\u200bStand upright with your feet together and arms at your sides.",
        "\u200bStep your right foot out to the side while swinging both arms up.",
    ]
    assert clean_instructions(steps) == [
        "Stand upright with your feet together and arms at your sides.",
        "Step your right foot out to the side while swinging both arms up.",
    ]


def test_section_headings_are_not_steps():
    steps = [
        "Starting position:",
        "Put your feet close together.",
        "Steps:",
        "Spin only your wrists.",
        "Repeat.",
        "Notes:",
        "This exercise requires a jump rope.",
    ]
    assert clean_instructions(steps) == [
        "Put your feet close together.",
        "Spin only your wrists.",
        "Repeat.",
        "This exercise requires a jump rope.",
    ]


def test_plain_steps_are_untouched():
    steps = ["Lie on the bench.", "Press the bar up."]
    assert clean_instructions(steps) == steps
    assert clean_instructions([]) == []
    assert clean_instructions(None) == []


def test_it_applies_on_the_way_out(client, auth):
    headers, _, _ = auth
    r = client.post(
        "/api/exercises",
        headers=headers,
        json={
            "name": "E2E Messy",
            "category": "strength",
            "equipment": "barbell",
            "primary_muscles": ["chest"],
            "instructions": ["A long preamble. " * 20, "Notes (Instructions):", "Do the thing."],
        },
    )
    assert r.status_code == 201, r.text
    assert r.json()["instructions"] == ["Do the thing."]
