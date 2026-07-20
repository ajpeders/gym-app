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


class RoutineRequest(BaseModel):
    text: str


class EditRoutineExercise(BaseModel):
    exercise: str
    target_sets: int | None = None
    target_reps: int | None = None
    target_reps_max: int | None = None
    target_weight: float | None = None
    notes: str | None = None


class EditRoutineRequest(BaseModel):
    instruction: str
    # The routine as it currently stands on the client (exercises by name), so
    # follow-up edits build on the last proposal rather than the saved version.
    name: str = ""
    notes: str | None = None
    exercises: list[EditRoutineExercise] = []


class CheckinRequest(BaseModel):
    text: str


class CoachRequest(BaseModel):
    message: str


@router.get("/providers")
def providers(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    return service.available_providers(db, user)


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


@router.post("/parse-routine")
async def parse_routine(
    body: RoutineRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    try:
        return await service.parse_routine(db, user, text)
    except AIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/parse-routine/stream")
async def parse_routine_stream(
    body: RoutineRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Server-Sent Events variant of parse-routine: emits `progress` events as
    the model generates (keeping slow generations alive on mobile), a final
    `result` event with the full payload, or an `error` event on failure."""
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    async def event_stream():
        try:
            async for ev in service.parse_routine_stream(db, user, text):
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


@router.post("/edit-routine/stream")
async def edit_routine_stream(
    body: EditRoutineRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """SSE conversational edit of one routine: `progress` events while the model
    generates, a final `result` event with the proposed routine (exercises
    resolved to the catalog), or an `error` event. Persists nothing — the client
    reviews and saves via PATCH /routines/{id}."""
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
            async for ev in service.edit_routine_stream(db, user, working, instruction):
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
