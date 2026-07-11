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
        self._started = False  # consumer task running? launch starts it; cold channels start lazily
        self._start_lock = asyncio.Lock()  # serialize lazy resume so concurrent access resumes once
        # Coarse persisted lifecycle (active|stopped) — drives resume reconciliation. Persisted only
        # on flips (not per-event), like the sid capture; absent in the registry ⇒ "active".
        self._persisted_lifecycle = "stopped" if handle.provider_state.get("status") == "stopped" else "active"
        self.created_at = created_at or _now_iso()
        # Hub-synthetic events (stream_crash / mark_dead) claim a FRESH epoch above the adapter's
        # current one (same mechanic as resume). Otherwise a client reconnecting with a prior-epoch
        # Last-Event-ID would filter them as "already seen" and silently lose the failure (review П1).
        self._dead_seq = _seq_base(handle) + SEQ_BLOCK

    # ---- consumption ----

    def start(self) -> None:
        """Spawn the consumer task that drains the adapter stream for this session's lifetime."""
        self._task = asyncio.create_task(self._consume(), name=f"channel:{self.handle.session_id}")
        self._started = True

    async def ensure_started(self) -> None:
        """Lazily resume the SDK client on first access (send/subscribe). Nothing is spawned at boot
        (fix: greedy resume leaked an idle claude process per persisted session). Idempotent, and
        serialized so concurrent first-accessers resume exactly once. A resume failure marks the
        channel dead + surfaces an error event instead of raising into the request (В2)."""
        if self._started or self._dead:
            return
        async with self._start_lock:
            if self._started or self._dead:
                return
            try:
                handle = await self._adapter.resume(self.handle)
            except Exception as exc:
                with span("channel.resume_failed", session_id=self.handle.session_id):
                    self.mark_dead("unresumable", str(exc))
                return
            self.handle = handle
            self._sid_persisted = handle.provider_state.get("sdk_session_id") is not None
            self._dead_seq = _seq_base(handle) + SEQ_BLOCK  # synthetic events ride the fresh epoch
            if self._store is not None:
                self._store.put(handle, self.request)
            self.start()

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
        self._maybe_persist_lifecycle()
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
        # `current_handle` (kernel contract; non-abstract default returns the handle as-is) reflects
        # in-memory provider state into the persistable handle: an sdk_session_id the provider only
        # learns mid-stream must reach the registry, or the session can't be resumed after restart.
        refreshed = self._adapter.current_handle(self.handle)
        if refreshed.provider_state.get("sdk_session_id"):
            self.handle = refreshed
            self._store.put(refreshed, self.request)
            self._sid_persisted = True

    def _maybe_persist_lifecycle(self) -> None:
        # Persist the coarse active|stopped lifecycle only when it FLIPS, so a restart can tell an
        # intentionally-stopped session (never resume) from a resumable one (reconcile → 'waiting').
        # At most a couple of writes per session — not per event, so delivery stays I/O-free.
        if self._store is None:
            return
        lifecycle = "stopped" if self._status == "stopped" else "active"
        if lifecycle == self._persisted_lifecycle:
            return
        self._persisted_lifecycle = lifecycle
        ps = {**self.handle.provider_state, "status": lifecycle}
        self.handle = self.handle.model_copy(update={"provider_state": ps})
        self._store.put(self.handle, self.request)

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

    @property
    def is_started(self) -> bool:
        """Has the consumer task (hence a live SDK client) been spun up? False for a cold channel
        loaded at boot but not yet accessed — it holds no process to disconnect on shutdown."""
        return self._started

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

    def reconcile_waiting(self) -> None:
        """Resume-time honesty: a restored session has no in-flight turn (SDK-resume = a fresh
        connection, no turn survives a restart), so it is idle-'waiting' until accessed — never the
        stale 'running' a crash-before-`done` would otherwise have frozen in the list."""
        self._status = "waiting"

    def mark_cold_stopped(self) -> None:
        """A session persisted as intentionally stopped: listed 'stopped', never resumed, and —
        unlike `mark_dead` — with no error event (it was stopped on purpose, not unrecoverable)."""
        self._status = "stopped"
        self._dead = True

    def mark_dead(self, code: str, message: str) -> None:
        """No consumer task: preload a stopped-status + error event so subscribers see the failure
        (used when resume cannot revive a persisted session — blueprint В2)."""
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
        if channel is None:
            return False
        await channel.ensure_started()  # lazy resume: first access spawns the client (fix)
        # A dead/ended channel (unresumable after restart, or intentionally stopped) has no live
        # client — report "not live" (API → 404) rather than let the adapter raise a 500 (review П3).
        if not channel.is_live:
            return False
        await self._adapter.send(channel.handle, text)
        return True

    async def subscribe(self, session_id: str, last_event_id: int | None) -> AsyncIterator[Event] | None:
        channel = self._channels.get(session_id)
        if channel is None:
            return None
        await channel.ensure_started()  # opening the stream is a first access → lazy resume (fix)
        return channel.subscribe(last_event_id)

    async def stop(self, session_id: str, force: bool = False) -> bool:
        channel = self._channels.get(session_id)
        if channel is None:
            return False
        # No lazy resume here: spawning a client only to stop it would recreate the idle/zombie
        # process this fix removes. adapter.stop is a no-op when nothing is live; force still tears
        # down registry + channel below.
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
        """Load the registry into memory as COLD channels — NO SDK client is spawned here. Lazy
        resume (first send/subscribe) revives the client on demand, so a restart no longer leaks a
        claude process per persisted session (fix). Status is reconciled honestly:

        - persisted 'stopped' → stays stopped, never resumed;
        - no sdk_session_id → unresumable, surfaced via an error event, never a crash (В2);
        - anything else → 'waiting' (no turn survives a restart → no honest 'running' to restore).

        В2 still holds: handles are in memory, the list shows them, and send/subscribe resume."""
        async with aspan("hub.resume_all"):
            for stored in self._store.all():
                if stored.handle.session_id in self._channels:
                    continue
                channel = SessionChannel(
                    stored.handle, stored.request, self._adapter, self._store, self._buffer_size,
                    created_at=stored.created_at,
                )
                ps = stored.handle.provider_state
                if ps.get("status") == "stopped":
                    channel.mark_cold_stopped()
                elif not ps.get("sdk_session_id"):
                    channel.mark_dead("unresumable", "no sdk_session_id in registry — cannot resume")
                else:
                    channel.reconcile_waiting()
                self._channels[stored.handle.session_id] = channel

    async def shutdown(self) -> None:
        """Tear down cleanly: disconnect every live SDK client so no orphaned/<defunct> claude
        process is left behind (fix), then cancel the consumer tasks. Cold channels never spawned a
        client (is_started False) — nothing to disconnect."""
        for channel in list(self._channels.values()):
            if channel.is_started:
                try:
                    await self._adapter.stop(channel.handle, force=True)
                except Exception:  # best-effort reap on shutdown — never block exit on a bad client
                    pass
            await channel.aclose()
