"""Implementability proof: a provider built ONLY from the public contract runs the full lifecycle.

If a fake provider can implement launch→stream→send→resume→stop using nothing but the exported
contract/event types — with zero access to kernel internals — then a real adapter (claude-code, and
future providers) can too. This is the brief's "тест на чистоту": a new provider is a new
`AgentProvider`, the kernel is not touched.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest

from omnifield_kernel import (
    AgentProvider,
    AgentSessionHandle,
    DoneEvent,
    DonePayload,
    Event,
    LaunchRequest,
    MessageEvent,
    MessagePayload,
    StatusEvent,
    StatusPayload,
    ThinkingEvent,
    ThinkingPayload,
    ToolCallEvent,
    ToolCallPayload,
    ToolResultEvent,
    ToolResultPayload,
    Usage,
    event_adapter,
)


class FakeProvider(AgentProvider):
    """A minimal in-memory provider. Knows only the contract — no kernel internals."""

    name = "fake"

    def __init__(self) -> None:
        self._live: dict[str, dict] = {}

    async def launch(self, request: LaunchRequest) -> AgentSessionHandle:
        sid = f"fake-{len(self._live) + 1}"
        # provider_state is opaque to the kernel; the adapter puts whatever it needs to resume.
        handle = AgentSessionHandle(
            session_id=sid,
            provider=self.name,
            provider_state={"cwd": request.repo, "permission": request.permission, "turns": 0},
        )
        self._live[sid] = {"inbox": [], "stopped": False}
        return handle

    async def send(self, handle: AgentSessionHandle, text: str) -> None:
        self._live[handle.session_id]["inbox"].append(text)

    async def stream(self, handle: AgentSessionHandle) -> AsyncIterator[Event]:
        sid = handle.session_id
        ts = "2026-07-08T12:00:00Z"
        seq = 0

        def nxt() -> int:
            nonlocal seq
            seq += 1
            return seq

        yield StatusEvent(session_id=sid, seq=nxt(), ts=ts, payload=StatusPayload(state="starting"))
        yield ThinkingEvent(session_id=sid, seq=nxt(), ts=ts, payload=ThinkingPayload(text="planning"))
        yield MessageEvent(session_id=sid, seq=nxt(), ts=ts, payload=MessagePayload(role="agent", text="on it"))
        yield ToolCallEvent(
            session_id=sid, seq=nxt(), ts=ts,
            payload=ToolCallPayload(call_id="c1", tool="Read", input={"path": "README.md"}),
        )
        yield ToolResultEvent(
            session_id=sid, seq=nxt(), ts=ts,
            payload=ToolResultPayload(call_id="c1", output="# readme", is_error=False),
        )
        yield DoneEvent(
            session_id=sid, seq=nxt(), ts=ts,
            payload=DonePayload(reason="completed", usage=Usage(input_tokens=5, output_tokens=7)),
        )

    async def resume(self, handle: AgentSessionHandle) -> AgentSessionHandle:
        # Re-attach by returning a handle with refreshed opaque state — kernel doesn't look inside.
        return handle.model_copy(update={"provider_state": {**handle.provider_state, "resumed": True}})

    async def stop(self, handle: AgentSessionHandle, force: bool = False) -> None:
        self._live[handle.session_id]["stopped"] = force or True


async def test_full_lifecycle():
    provider = FakeProvider()
    req = LaunchRequest(role="owner", repo="omnifield/brainer", permission="standard", brief="do X")

    handle = await provider.launch(req)
    assert handle.provider == "fake"
    assert handle.provider_state["permission"] == "standard"

    events = [e async for e in provider.stream(handle)]
    assert [e.type for e in events] == [
        "status", "thinking", "message", "tool-call", "tool-result", "done",
    ]
    # seq is monotonic within the session (reconnect-dedup contract).
    assert [e.seq for e in events] == [1, 2, 3, 4, 5, 6]
    # every emitted event is valid against the wire contract.
    for e in events:
        assert event_adapter.validate_python(e.model_dump()) == e

    await provider.send(handle, "follow-up")
    assert provider._live[handle.session_id]["inbox"] == ["follow-up"]

    resumed = await provider.resume(handle)
    assert resumed.session_id == handle.session_id
    assert resumed.provider_state["resumed"] is True

    await provider.stop(handle, force=True)
    assert provider._live[handle.session_id]["stopped"] is True


def test_incomplete_provider_cannot_instantiate():
    # The ABC forces the whole contract to be implemented — a partial provider fails fast.
    class Partial(AgentProvider):
        name = "partial"

        async def launch(self, request: LaunchRequest) -> AgentSessionHandle:  # pragma: no cover
            raise NotImplementedError

    with pytest.raises(TypeError):
        Partial()  # missing send/stream/resume/stop
