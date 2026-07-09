"""ChannelHub + SessionChannel — session lifecycle over the kernel contract."""

from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime

from omnifield_kernel import (
    AgentProvider,
    AgentSessionHandle,
    ErrorEvent,
    ErrorPayload,
    Event,
    LaunchRequest,
    SessionStore,
    StatusEvent,
    StatusPayload,
)

from ..lib.trace import aspan, span
from .seq import SEQ_BLOCK


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


@dataclass
class SessionSummary:
    """List-view projection of a session (blueprint §1.5 / reply §2): persisted identity + live status.

    snake_case to match the event wire format — the BFF does not translate. Not persisted; derived
    from the registry row + the in-memory channel status."""

    session_id: str
    provider: str
    role: str
    repo: str
    status: str  # starting | running | waiting | stopped
    sdk_session_id: str | None
    created_at: str
    updated_at: str


class SessionChannel:
    """One session: consumes the adapter stream, buffers for replay, fans out to subscribers."""

    def __init__(
        self,
        handle: AgentSessionHandle,
        request: LaunchRequest,
        adapter: AgentProvider,
        store: SessionStore,
        buffer_size: int,
        *,
        created_at: str | None = None,
    ) -> None:
        self.handle = handle
        self.request = request
        self._adapter = adapter
        self._store = store
        self._events: deque[Event] = deque(maxlen=buffer_size)
        self._subscribers: set[asyncio.Queue[Event]] = set()
        self._status = "starting"
        self._sid_persisted = handle.provider_state.get("sdk_session_id") is not None
        self._task: asyncio.Task | None = None
        self._dead = False
        self.created_at = created_at or _now_iso()
        # Hub-synthetic events (stream_crash / mark_dead) claim a FRESH epoch above the adapter's
        # current one (same mechanic as resume). Otherwise a client reconnecting with a prior-epoch
        # Last-Event-ID would filter them as "already seen" and silently lose the failure (review П1).
        self._dead_seq = _seq_base(handle) + SEQ_BLOCK

    # ---- consumption ----

    def start(self) -> None:
        """Spawn the consumer task that drains the adapter stream for this session's lifetime."""
        self._task = asyncio.create_task(self._consume(), name=f"channel:{self.handle.session_id}")

    async def _consume(self) -> None:
        async with aspan("channel.consume", session_id=self.handle.session_id):
            try:
                async for event in self._adapter.stream(self.handle):
                    self._ingest(event)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # provider blew up outside the contract — surface, don't die silently
                self._dead = True  # the client is gone; further sends must not 500 (review П3)
                self._ingest(self._make_error("stream_crash", str(exc)))
            # Stream ended → the session is no longer producing.
            self._status = "stopped"

    def _ingest(self, event: Event) -> None:
        # asyncio is single-threaded and there is no await here, so append + fan-out is atomic.
        self._events.append(event)
        self._project(event)
        self._maybe_persist_sid()
        for q in list(self._subscribers):
            q.put_nowait(event)

    def _project(self, event: Event) -> None:
        t = event.type
        if t == "status":
            self._status = event.payload.state
        elif t in ("message", "thinking", "tool-call", "tool-result"):
            self._status = "running"
        elif t == "done":
            self._status = "stopped" if event.payload.reason == "stopped" else "waiting"

    def _maybe_persist_sid(self) -> None:
        if self._sid_persisted:
            return
        # `current_handle` reflects in-memory state (captured sdk_session_id) into the persistable
        # handle. It is entering the kernel `AgentProvider` as a non-abstract default (review П2,
        # owner-kernel); until then keep the hub provider-agnostic — a provider without it just
        # yields the handle unchanged rather than crashing the consume task.
        refreshed = getattr(self._adapter, "current_handle", lambda h: h)(self.handle)
        if refreshed.provider_state.get("sdk_session_id"):
            self.handle = refreshed
            self._store.put(refreshed, self.request)
            self._sid_persisted = True

    # ---- subscription ----

    async def subscribe(self, last_event_id: int | None) -> AsyncIterator[Event]:
        """Replay buffered events (fresh connect = whole buffer; reconnect = seq > last_event_id),
        then live events, deduped by seq. Register BEFORE snapshotting so nothing slips the window."""
        q: asyncio.Queue[Event] = asyncio.Queue()
        self._subscribers.add(q)
        snapshot = list(self._events)
        try:
            cutoff = last_event_id if last_event_id is not None else -1
            last_seq = cutoff
            for event in snapshot:
                if event.seq > cutoff:
                    last_seq = max(last_seq, event.seq)
                    yield event
            while True:
                event = await q.get()
                if event.seq > last_seq:
                    last_seq = event.seq
                    yield event
        finally:
            self._subscribers.discard(q)

    # ---- status / teardown ----

    @property
    def status(self) -> str:
        return self._status

    @property
    def is_live(self) -> bool:
        """A session that can still take a `send`: not dead-marked (unresumable) and not crashed."""
        return not self._dead

    def summary(self, stored_created: str, stored_updated: str) -> SessionSummary:
        ps = self.handle.provider_state
        return SessionSummary(
            session_id=self.handle.session_id,
            provider=self.handle.provider,
            role=self.request.role,
            repo=self.request.repo,
            status=self._status,
            sdk_session_id=ps.get("sdk_session_id"),
            created_at=stored_created,
            updated_at=stored_updated,
        )

    def mark_dead(self, code: str, message: str) -> None:
        """No consumer task: preload a stopped-status + error event so subscribers see the failure
        (used when resume-on-start cannot revive a persisted session — blueprint В2)."""
        self._dead = True
        self._status = "stopped"
        self._ingest(StatusEvent(session_id=self.handle.session_id, seq=self._next_dead_seq(), ts=_now_iso(),
                                 payload=StatusPayload(state="stopped", detail="unresumable")))
        self._ingest(self._make_error(code, message))

    async def aclose(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    # ---- helpers ----

    def _next_dead_seq(self) -> int:
        s = self._dead_seq
        self._dead_seq += 1
        return s

    def _make_error(self, code: str, message: str) -> ErrorEvent:
        return ErrorEvent(
            session_id=self.handle.session_id,
            seq=self._next_dead_seq(),
            ts=_now_iso(),
            payload=ErrorPayload(code=code, message=message, retryable=False),
        )


def _seq_base(handle: AgentSessionHandle) -> int:
    return int(handle.provider_state.get("seq_base", 0) or 0)


class ChannelHub:
    """Owns all live SessionChannels; the single object the API talks to."""

    def __init__(self, adapter: AgentProvider, store: SessionStore, buffer_size: int) -> None:
        self._adapter = adapter
        self._store = store
        self._buffer_size = buffer_size
        self._channels: dict[str, SessionChannel] = {}

    async def launch(self, request: LaunchRequest) -> str:
        async with aspan("hub.launch", role=request.role, repo=request.repo):
            handle = await self._adapter.launch(request)
            self._store.put(handle, request)
            channel = SessionChannel(handle, request, self._adapter, self._store, self._buffer_size)
            channel.start()
            self._channels[handle.session_id] = channel
            return handle.session_id

    async def send(self, session_id: str, text: str) -> bool:
        channel = self._channels.get(session_id)
        # A dead/ended channel (e.g. unresumable after restart) has no live client — report
        # "not live" (API → 404) instead of letting the adapter raise a 500 (review П3).
        if channel is None or not channel.is_live:
            return False
        await self._adapter.send(channel.handle, text)
        return True

    def subscribe(self, session_id: str, last_event_id: int | None) -> AsyncIterator[Event] | None:
        channel = self._channels.get(session_id)
        if channel is None:
            return None
        return channel.subscribe(last_event_id)

    async def stop(self, session_id: str, force: bool = False) -> bool:
        channel = self._channels.get(session_id)
        if channel is None:
            return False
        await self._adapter.stop(channel.handle, force=force)
        if force:
            await channel.aclose()
            self._channels.pop(session_id, None)
            self._store.delete(session_id)
        return True

    def list_sessions(self) -> list[SessionSummary]:
        out: list[SessionSummary] = []
        for stored in self._store.all():
            channel = self._channels.get(stored.handle.session_id)
            if channel is not None:
                out.append(channel.summary(stored.created_at, stored.updated_at))
        return out

    async def resume_all(self) -> None:
        """Revive persisted sessions on start-up. An unresumable one is marked + surfaced via an
        error event, never a crash (deliverable 2 / В2)."""
        async with aspan("hub.resume_all"):
            for stored in self._store.all():
                if stored.handle.session_id in self._channels:
                    continue
                try:
                    handle = await self._adapter.resume(stored.handle)
                    self._store.put(handle, stored.request)
                    channel = SessionChannel(
                        handle, stored.request, self._adapter, self._store, self._buffer_size,
                        created_at=stored.created_at,
                    )
                    channel.start()
                    self._channels[handle.session_id] = channel
                except Exception as exc:
                    with span("hub.resume_failed", session_id=stored.handle.session_id):
                        dead = SessionChannel(
                            stored.handle, stored.request, self._adapter, self._store, self._buffer_size,
                            created_at=stored.created_at,
                        )
                        dead.mark_dead("unresumable", str(exc))
                        self._channels[stored.handle.session_id] = dead

    async def shutdown(self) -> None:
        for channel in list(self._channels.values()):
            await channel.aclose()
