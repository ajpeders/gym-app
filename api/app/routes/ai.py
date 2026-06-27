"""AI endpoints: natural-language set logging + provider discovery."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
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
