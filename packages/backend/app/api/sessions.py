"""Session routes = the contract (thin; no logic — that lives in FleetService).

  GET   /api/sessions            -> [Session]
  POST  /api/sessions            {repo, scope, briefPath?} -> {id}
  GET   /api/sessions/:id        -> SessionDetail
  GET   /api/sessions/:id/stream -> SSE activity events
  POST  /api/sessions/:id/stop   -> {ok}
  POST  /api/sessions/:id/brief  {briefPath|briefText} -> {ok}
"""

from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from starlette.requests import Request

from ..deps import Deps
from ..sessions.models import (
    AssignBriefInput,
    CreateSessionInput,
    Session,
    SessionDetail,
)
from .deps import get_deps

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("", response_model=list[Session])
async def list_sessions(deps: Deps = Depends(get_deps)) -> list[Session]:
    return await deps.fleet.list_sessions()


@router.post("")
async def create_session(input: CreateSessionInput, deps: Deps = Depends(get_deps)) -> dict[str, str]:
    try:
        session_id = await deps.fleet.launch(input)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"id": session_id}


@router.get("/{session_id}", response_model=SessionDetail)
async def get_session(session_id: str, deps: Deps = Depends(get_deps)) -> SessionDetail:
    detail = await deps.fleet.get_session(session_id)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"session not found: {session_id}")
    return detail


@router.post("/{session_id}/stop")
async def stop_session(session_id: str, deps: Deps = Depends(get_deps)) -> dict[str, bool]:
    ok = deps.fleet.stop(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail=f"session not found: {session_id}")
    return {"ok": True}


@router.post("/{session_id}/brief")
async def assign_brief(
    session_id: str, input: AssignBriefInput, deps: Deps = Depends(get_deps)
) -> dict[str, bool]:
    ok = deps.fleet.assign_brief(session_id, input)
    if not ok:
        raise HTTPException(status_code=404, detail=f"session not found: {session_id}")
    return {"ok": True}


@router.get("/{session_id}/stream")
async def stream_session(session_id: str, request: Request, deps: Deps = Depends(get_deps)) -> StreamingResponse:
    scope = deps.fleet.scope_of(session_id)
    if scope is None:
        raise HTTPException(status_code=404, detail=f"session not found: {session_id}")
    poll_s = deps.settings.stream_poll_s

    async def event_stream():
        # Only stream events newer than connect time — no history replay.
        since = time.time_ns()
        while not await request.is_disconnected():
            for ns, event in await deps.telemetry.events_since(scope, since):
                event.session_id = session_id
                since = max(since, ns)
                yield f"data: {event.model_dump_json(by_alias=True)}\n\n"
            await asyncio.sleep(poll_s)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
