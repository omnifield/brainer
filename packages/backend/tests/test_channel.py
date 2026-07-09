"""Channel unit tests — buffer/replay by seq (no dupes), status projection, resume-on-start.

SessionChannel replay is driven by ingesting crafted contract events directly (no live SDK). Hub
lifecycle uses a FakeAdapter implementing the kernel `AgentProvider` seam.
"""

from __future__ import annotations

import asyncio

import pytest
from omnifield_kernel import (
    AgentProvider,
    AgentSessionHandle,
    DoneEvent,
    DonePayload,
    LaunchRequest,
    MessageEvent,
    MessagePayload,
    SessionStore,
    StatusEvent,
    StatusPayload,
    Usage,
)

from app.channel.hub import ChannelHub, SessionChannel


def _handle(sid: str = "s1", sdk_sid: str | None = "sdk-1", seq_base: int = 0) -> AgentSessionHandle:
    return AgentSessionHandle(
        session_id=sid, provider="fake",
        provider_state={"sdk_session_id": sdk_sid, "seq_base": seq_base, "cwd": "/r", "config_dir": None},
    )


def _request(role: str = "backend") -> LaunchRequest:
    return LaunchRequest(role=role, repo="omnifield/brainer", permission="standard")


def _msg(seq: int, text: str = "hi") -> MessageEvent:
    return MessageEvent(
        session_id="s1", seq=seq, ts="2026-07-09T00:00:00Z", payload=MessagePayload(role="agent", text=text)
    )


async def _drain(agen) -> list:
    """Collect events yielded without blocking (replayed buffer), then stop before the live wait."""
    out = []
    it = agen.__aiter__()
    while True:
        try:
            out.append(await asyncio.wait_for(it.__anext__(), 0.05))
        except (TimeoutError, StopAsyncIteration):
            break
    await agen.aclose()
    return out


def _channel() -> SessionChannel:
    # sdk_session_id already set → persist path is a no-op, so adapter/store can be None here.
    return SessionChannel(_handle(), _request(), adapter=None, store=None, buffer_size=100)


async def test_fresh_connect_replays_whole_buffer():
    ch = _channel()
    for i in range(4):
        ch._ingest(_msg(i))
    events = await _drain(ch.subscribe(None))
    assert [e.seq for e in events] == [0, 1, 2, 3]


async def test_reconnect_replays_only_after_last_event_id():
    ch = _channel()
    for i in range(5):
        ch._ingest(_msg(i))
    events = await _drain(ch.subscribe(last_event_id=2))
    assert [e.seq for e in events] == [3, 4]  # nothing <= 2, no dupes


async def test_live_event_after_subscribe_is_delivered_once():
    ch = _channel()
    ch._ingest(_msg(0))
    agen = ch.subscribe(None)
    first = await agen.__anext__()  # registers subscriber, yields buffered seq 0
    assert first.seq == 0
    ch._ingest(_msg(1))  # arrives live
    nxt = await asyncio.wait_for(agen.__anext__(), 0.5)
    assert nxt.seq == 1
    await agen.aclose()


async def test_status_projection_running_then_waiting():
    ch = _channel()
    assert ch.status == "starting"
    ch._ingest(_msg(0))
    assert ch.status == "running"
    done = DoneEvent(
        session_id="s1", seq=1, ts="t",
        payload=DonePayload(reason="completed", usage=Usage(input_tokens=1, output_tokens=1)),
    )
    ch._ingest(done)
    assert ch.status == "waiting"


async def test_status_follows_explicit_status_event():
    ch = _channel()
    ch._ingest(StatusEvent(session_id="s1", seq=0, ts="t", payload=StatusPayload(state="waiting")))
    assert ch.status == "waiting"


async def test_mark_dead_surfaces_stopped_and_error():
    ch = _channel()
    ch.mark_dead("unresumable", "no sdk id")
    assert ch.status == "stopped"
    events = await _drain(ch.subscribe(None))
    types = [e.type for e in events]
    assert "status" in types and "error" in types
    err = next(e for e in events if e.type == "error")
    assert err.payload.code == "unresumable"
    assert err.payload.retryable is False


# ---- hub lifecycle over a fake provider ----


class FakeAdapter(AgentProvider):
    name = "fake"

    def __init__(self, events: list, *, resume_ok: bool = True) -> None:
        self._events = events
        self._resume_ok = resume_ok
        self.sent: list[tuple[str, str]] = []
        self.stopped: list[tuple[str, bool]] = []

    async def launch(self, request: LaunchRequest) -> AgentSessionHandle:
        return _handle("s1")

    async def send(self, handle: AgentSessionHandle, text: str) -> None:
        self.sent.append((handle.session_id, text))

    async def stream(self, handle: AgentSessionHandle):
        for e in self._events:
            yield e

    async def resume(self, handle: AgentSessionHandle) -> AgentSessionHandle:
        if not self._resume_ok:
            raise RuntimeError("boom")
        return handle

    async def stop(self, handle: AgentSessionHandle, force: bool = False) -> None:
        self.stopped.append((handle.session_id, force))

    def current_handle(self, handle: AgentSessionHandle) -> AgentSessionHandle:
        return handle


@pytest.fixture
def store(tmp_path):
    s = SessionStore(tmp_path / "sessions.db")
    yield s
    s.close()


async def test_hub_launch_streams_and_lists(store):
    adapter = FakeAdapter([_msg(0), _msg(1)])
    hub = ChannelHub(adapter, store, buffer_size=100)
    sid = await hub.launch(_request())
    await asyncio.sleep(0.05)  # let the consumer task drain the fake stream
    sessions = hub.list_sessions()
    assert len(sessions) == 1
    assert sessions[0].session_id == sid
    assert sessions[0].role == "backend"
    assert store.get(sid) is not None  # persisted


async def test_hub_send_and_stop(store):
    adapter = FakeAdapter([])
    hub = ChannelHub(adapter, store, buffer_size=100)
    sid = await hub.launch(_request())
    assert await hub.send(sid, "follow up") is True
    assert adapter.sent == [(sid, "follow up")]
    assert await hub.send("nope", "x") is False
    assert await hub.stop(sid, force=True) is True
    assert adapter.stopped == [(sid, True)]
    assert store.get(sid) is None  # hard stop removes the row


async def test_resume_all_revives_and_marks_dead(store):
    # Seed two persisted sessions; one resumable, one that fails to resume.
    store.put(_handle("ok"), _request("backend"))
    store.put(_handle("bad"), _request("kernel"))

    good = FakeAdapter([], resume_ok=True)
    hub_ok = ChannelHub(good, store, buffer_size=100)
    await hub_ok.resume_all()
    assert any(s.session_id == "ok" for s in hub_ok.list_sessions())

    bad = FakeAdapter([], resume_ok=False)
    hub_bad = ChannelHub(bad, store, buffer_size=100)
    await hub_bad.resume_all()
    # A failed resume still yields a channel that surfaces an error event, not a crash.
    dead = hub_bad.subscribe("bad", None)
    events = await _drain(dead)
    assert any(e.type == "error" for e in events)
