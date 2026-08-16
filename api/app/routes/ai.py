"""AI endpoints: natural-language set logging + provider discovery."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..ai import service
from ..ai.base import AIError
from ..db import get_db
from ..models import User
from ..security import get_current_user

router = APIRouter(prefix="/ai", tags=["ai"])


class ParseRequest(BaseModel):
    text: str
    workout_id: int | None = None


class WorkoutRequest(BaseModel):
    text: str


class EditWorkoutExercise(BaseModel):
    exercise: str
    target_sets: int | None = None
    target_reps: int | None = None
    target_reps_max: int | None = None
    target_weight: float | None = None
    target_weight_max: float | None = None
    target_duration_seconds: int | None = None
    target_duration_seconds_max: int | None = None
    notes: str | None = None


class EditWorkoutRequest(BaseModel):
    instruction: str
    # The workout as it currently stands on the client (exercises by name), so
    # follow-up edits build on the last proposal rather than the saved version.
    name: str = ""
    notes: str | None = None
    exercises: list[EditWorkoutExercise] = []


class EditSplitDay(BaseModel):
    id: int | None = None
    name: str = ""
    weekdays: list[int] = []
    floating: bool = False


class EditSplitRequest(BaseModel):
    instruction: str
    # The split as it currently stands on the client, so follow-up edits build
    # on the last proposal rather than the saved version.
    name: str = ""
    notes: str | None = None
    rules: list[str] = []
    days: list[EditSplitDay] = []


class NutritionParseRequest(BaseModel):
    text: str


class CheckinRequest(BaseModel):
    text: str


class CoachRequest(BaseModel):
    message: str


@router.get("/providers")
def providers(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    return service.available_providers(db, user)


class ExerciseQuestion(BaseModel):
    exercise_id: int
    question: str


@router.post("/exercise-qa")
async def exercise_qa(
    payload: ExerciseQuestion,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Ask about one movement — grounded in that exercise's catalog entry."""
    try:
        return await service.exercise_qa(db, user, payload.exercise_id, payload.question)
    except AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


class GenerateProgramRequest(BaseModel):
    """Who the program is for. Everything is optional — an empty request still
    produces something sensible, grounded in the athlete profile."""

    goal: str = ""
    days_per_week: int = 3
    experience: str = ""
    equipment: str = ""


@router.post("/generate-program")
async def generate_program(
    payload: GenerateProgramRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Write a program from a description. A proposal — nothing is saved."""
    try:
        return await service.generate_program(
            db,
            user,
            goal=payload.goal,
            days_per_week=payload.days_per_week,
            experience=payload.experience,
            equipment=payload.equipment,
        )
    except AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/models")
async def models(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    try:
        return await service.list_models(db, user)
    except AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/test")
async def test(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    try:
        return await service.test_provider(db, user)
    except AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/check-model")
async def check_model(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    try:
        return await service.check_model(db, user)
    except AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/parse-sets")
async def parse_sets(
    body: ParseRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        return await service.parse_sets(db, user, text, body.workout_id)
    except AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/parse-days")
async def parse_days(
    body: ParseRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Split a multi-day paste into one set of matched exercises per day.

    Used by catch-up, where the notes hold a whole week rather than one bout.
    """
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        return await service.parse_days(db, user, text)
    except AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/parse-workout")
async def parse_workout(
    body: WorkoutRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        return await service.parse_workout(db, user, text)
    except AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/parse-workout/stream")
async def parse_workout_stream(
    body: WorkoutRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Server-Sent Events variant of parse-workout: emits `progress` events as
    the model generates (keeping slow generations alive on mobile), a final
    `result` event with the full payload, or an `error` event on failure."""
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    async def event_stream():
        try:
            async for ev in service.parse_workout_stream(db, user, text):
                if ev.get("type") == "progress":
                    yield _sse("progress", {"received": ev.get("received", 0)})
                else:
                    payload = {k: v for k, v in ev.items() if k != "type"}
                    yield _sse("result", payload)
        except AIError as exc:
            yield _sse("error", {"detail": str(exc)})
        except Exception:  # noqa: BLE001
            yield _sse("error", {"detail": "The AI request failed unexpectedly."})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable proxy buffering (nginx/Traefik)
        },
    )


@router.post("/edit-workout/stream")
async def edit_workout_stream(
    body: EditWorkoutRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """SSE conversational edit of one workout: `progress` events while the model
    generates, a final `result` event with the proposed workout (exercises
    resolved to the catalog), or an `error` event. Persists nothing — the client
    reviews and saves via PATCH /workouts/{id}."""
    instruction = (body.instruction or "").strip()
    if not instruction:
        raise HTTPException(status_code=400, detail="instruction is required")

    working = {
        "name": body.name,
        "notes": body.notes,
        "exercises": [e.model_dump() for e in body.exercises],
    }

    async def event_stream():
        try:
            async for ev in service.edit_workout_stream(db, user, working, instruction):
                if ev.get("type") == "progress":
                    yield _sse("progress", {"received": ev.get("received", 0)})
                else:
                    payload = {k: v for k, v in ev.items() if k != "type"}
                    yield _sse("result", payload)
        except AIError as exc:
            yield _sse("error", {"detail": str(exc)})
        except Exception:  # noqa: BLE001
            yield _sse("error", {"detail": "The AI request failed unexpectedly."})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable proxy buffering (nginx/Traefik)
        },
    )


@router.post("/edit-split/stream")
async def edit_split_stream(
    body: EditSplitRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """SSE conversational edit of one split's shape (name, notes, progression
    rules, and each day's weekday scheduling). Persists nothing — the client
    reviews and saves via PATCH /splits/{id} and PATCH /workouts/{id}."""
    instruction = (body.instruction or "").strip()
    if not instruction:
        raise HTTPException(status_code=400, detail="instruction is required")

    working = {
        "name": body.name,
        "notes": body.notes,
        "rules": body.rules,
        "days": [d.model_dump() for d in body.days],
    }

    async def event_stream():
        try:
            async for ev in service.edit_split_stream(db, user, working, instruction):
                if ev.get("type") == "progress":
                    yield _sse("progress", {"received": ev.get("received", 0)})
                else:
                    payload = {k: v for k, v in ev.items() if k != "type"}
                    yield _sse("result", payload)
        except AIError as exc:
            yield _sse("error", {"detail": str(exc)})
        except Exception:  # noqa: BLE001
            yield _sse("error", {"detail": "The AI request failed unexpectedly."})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable proxy buffering (nginx/Traefik)
        },
    )


@router.post("/parse-nutrition")
async def parse_nutrition(
    body: NutritionParseRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Parse a sentence about food into calorie/protein entries. Persists
    nothing — the client reviews and posts them to /nutrition."""
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        return await service.parse_nutrition(db, user, text)
    except AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/check-in")
async def check_in(
    body: CheckinRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        return await service.check_in(db, user, text)
    except AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/coach/history")
def coach_history(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    return {"messages": service.coach_history(db, user.id)}


@router.post("/coach")
async def coach(
    body: CoachRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    message = (body.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="message is required")
    try:
        return await service.coach(db, user, message)
    except AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
