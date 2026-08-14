"""Crashes in the gym should leave a trace.

Nothing recorded errors before this: an app crash mid-session vanished with
the app. One pipeline — the client posts what it caught, the API logs it
structurally alongside its own unhandled exceptions — so there is a single
place to look, and no new infrastructure to stand up in the homelab.
"""
from __future__ import annotations

import logging


def _report(client, headers=None, **fields):
    body = {"message": "Cannot read property 'id' of undefined", **fields}
    return client.post("/api/errors", json=body, headers=headers or {})


def test_a_crash_report_is_accepted(client):
    r = _report(client)
    assert r.status_code == 202, r.text


def test_a_crash_is_reportable_without_being_logged_in(client):
    """The login screen can crash too, and that's exactly when you'd want to know."""
    assert _report(client).status_code == 202


def test_the_report_reaches_the_log(client, caplog):
    with caplog.at_level(logging.ERROR, logger="gym.client"):
        _report(client, stack="at Foo (App.tsx:12)", platform="ios", app_version="1.0.0")

    logged = "\n".join(r.getMessage() for r in caplog.records)
    assert "Cannot read property" in logged
    assert "App.tsx:12" in logged


def test_a_signed_in_report_records_who_hit_it(client, auth, caplog):
    headers, _, _ = auth
    with caplog.at_level(logging.ERROR, logger="gym.client"):
        _report(client, headers=headers)

    assert any("user=" in r.getMessage() for r in caplog.records)


def test_an_empty_message_is_rejected(client):
    assert client.post("/api/errors", json={"message": "   "}).status_code == 422


def test_an_enormous_stack_is_truncated_not_refused(client, caplog):
    """A runaway stack must not become a way to flood the log or the request."""
    with caplog.at_level(logging.ERROR, logger="gym.client"):
        r = _report(client, stack="x" * 100_000)

    assert r.status_code == 202
    assert max(len(rec.getMessage()) for rec in caplog.records) < 20_000
