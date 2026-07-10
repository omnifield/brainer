"""Session routes = the control-channel surface (blueprint §1.5). Thin; logic lives in ChannelHub.

Mounted under the native `/brainer` prefix in the app factory (gateway parity); paths below are
relative to it, i.e. `/brainer/sessions` on the wire.

  GET  /sessions                 -> [SessionSummary]        list projection
  POST /sessions                 {repo, scope, brief?, model?} -> {id}   launch (headless)
  GET  /sessions/{id}/events     -> SSE stream (Last-Event-ID = seq reconnect; events as-is)
  POST /sessions/{id}/messages   {text} -> {ok}             send into the live session
  POST /sessions/{id}/stop       {force?} -> {ok}           soft interrupt / hard kill

Events go out as the kernel envelope verbatim (snake_case) — the BFF translates nothing. The
launch/stop/events/messages shapes are shared with the frontend; change only via architect.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from omnifield_kernel import LaunchRequest, PermissionLevel
from pydantic import BaseModel
from starlette.requests import Request

from ..channel import SessionSummary
from ..config import role_for_scope
from ..deps import Deps
from .deps import get_deps

router = APIRouter(prefix="/sessions", tags=["sessions"])


class LaunchInput(BaseModel):
    repo: str
    scope: str  # zone identity (main / backend / …); drives OMNIFIELD_SCOPE + role/permission
    brief: str | None = None
    model: str | None = None


class SendInput(BaseModel):
    text: str


class StopInput(BaseModel):
    force: bool = False


# Pre-presets permission by role (blueprint §2.2 defaults; readonly is reserved, not launched in MVP).
def _permission_for(scope: str) -> PermissionLevel:
    return "trusted" if role_for_scope(scope) == "architect" else "standard"


@router.get("", response_model=list[SessionSummary])
async def list_sessions(deps: Deps = Depends(get_deps)) -> list[SessionSummary]:
    return deps.hub.list_sessions()


@router.post("")
async def launch_session(input: LaunchInput, deps: Deps = Depends(get_deps)) -> dict[str, str]:
    if deps.settings.repo(input.repo) is None:
        raise HTTPException(status_code=400, detail=f"unknown repo: {input.repo}")
    request = LaunchRequest(
        role=input.scope,  # pre-presets: the scope/zone IS the role identity hooks + OTEL key on
        repo=input.repo,
        permission=_permission_for(input.scope),
        brief=input.brief,
        model=input.model,
    )
    session_id = await deps.hub.launch(request)
    return {"id": session_id}


@router.post("/{session_id}/messages")
async def send_message(session_id: str, input: SendInput, deps: Deps = Depends(get_deps)) -> dict[str, bool]:
    ok = await deps.hub.send(session_id, input.text)
    if not ok:
        raise HTTPException(status_code=404, detail=f"session not live: {session_id}")
    return {"ok": True}


@router.post("/{session_id}/stop")
async def stop_session(
    session_id: str, input: StopInput | None = None, deps: Deps = Depends(get_deps)
) -> dict[str, bool]:
    ok = await deps.hub.stop(session_id, force=(input.force if input else False))
    if not ok:
        raise HTTPException(status_code=404, detail=f"session not found: {session_id}")
    return {"ok": True}


@router.get("/{session_id}/events")
async def stream_events(session_id: str, request: Request, deps: Deps = Depends(get_deps)) -> StreamingResponse:
    last = request.headers.get("Last-Event-ID")
    last_event_id = int(last) if last and last.lstrip("-").isdigit() else None
    stream = deps.hub.subscribe(session_id, last_event_id)
    if stream is None:
        raise HTTPException(status_code=404, detail=f"session not found: {session_id}")

    async def event_stream():
        async for event in stream:
            # SSE `id:` = seq → the browser echoes it as Last-Event-ID on reconnect (dedup/replay).
            yield f"id: {event.seq}\ndata: {event.model_dump_json()}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
