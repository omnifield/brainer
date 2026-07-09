"""Adapter unit tests — SDK→event mapping, permission/options, seq, limit/error branches.

The SDK is not spawned: we hand real SDK message/block dataclasses to the pure `map_sdk_message`
and inspect the emitted contract events. `_build_options` is checked without connecting a client.
"""

from __future__ import annotations

import asyncio

import claude_agent_sdk as sdk
import pytest
from omnifield_kernel import AgentSessionHandle

from app.adapters.claude_code import (
    _PERMISSION_MODE,
    SEQ_BLOCK,
    ClaudeCodeAdapter,
    _LiveSession,
    map_sdk_message,
)
from app.config import Settings


def _live(seq_base: int = 0) -> _LiveSession:
    return _LiveSession(client=None, cwd="/repo", config_dir=None, seq_base=seq_base)


def test_assistant_text_maps_to_message():
    live = _live()
    msg = sdk.AssistantMessage(content=[sdk.TextBlock(text="hello")], model="opus", session_id="sdk-1")
    events = map_sdk_message(msg, live, "s1")
    assert len(events) == 1
    ev = events[0]
    assert ev.type == "message"
    assert ev.payload.role == "agent"
    assert ev.payload.text == "hello"
    assert ev.session_id == "s1"
    assert ev.seq == 0
    assert live.sdk_session_id == "sdk-1"  # captured for resume


def test_thinking_and_toolcall_seq_monotonic():
    live = _live()
    msg = sdk.AssistantMessage(
        content=[
            sdk.ThinkingBlock(thinking="pondering", signature="sig"),
            sdk.ToolUseBlock(id="u1", name="Read", input={"path": "x"}),
            sdk.TextBlock(text="done"),
        ],
        model="opus",
    )
    events = map_sdk_message(msg, live, "s1")
    assert [e.type for e in events] == ["thinking", "tool-call", "message"]
    assert [e.seq for e in events] == [0, 1, 2]
    assert events[0].payload.text == "pondering"
    assert events[1].payload.call_id == "u1"
    assert events[1].payload.tool == "Read"
    assert events[1].payload.input == {"path": "x"}


def test_user_tool_result_maps():
    live = _live()
    msg = sdk.UserMessage(content=[sdk.ToolResultBlock(tool_use_id="u1", content="output", is_error=False)])
    events = map_sdk_message(msg, live, "s1")
    assert len(events) == 1
    assert events[0].type == "tool-result"
    assert events[0].payload.call_id == "u1"
    assert events[0].payload.output == "output"
    assert events[0].payload.is_error is False


def test_system_init_maps_to_status_and_captures_sid():
    live = _live()
    msg = sdk.SystemMessage(subtype="init", data={"session_id": "sdk-42"})
    events = map_sdk_message(msg, live, "s1")
    assert events[0].type == "status"
    assert events[0].payload.state == "starting"
    assert events[0].payload.detail == "init"
    assert live.sdk_session_id == "sdk-42"


def test_result_success_maps_to_done_with_usage():
    live = _live()
    msg = sdk.ResultMessage(
        subtype="success", duration_ms=10, duration_api_ms=5, is_error=False, num_turns=1,
        session_id="sdk-1", total_cost_usd=0.02, usage={"input_tokens": 100, "output_tokens": 50},
    )
    events = map_sdk_message(msg, live, "s1")
    assert len(events) == 1
    done = events[0]
    assert done.type == "done"
    assert done.payload.reason == "completed"
    assert done.payload.usage.input_tokens == 100
    assert done.payload.usage.output_tokens == 50
    assert done.payload.usage.cost_usd == 0.02


def test_result_error_emits_error_then_done():
    live = _live()
    msg = sdk.ResultMessage(
        subtype="error_during_execution", duration_ms=1, duration_api_ms=1, is_error=True, num_turns=1,
        session_id="sdk-1", api_error_status=529, errors=["overloaded"], usage={},
    )
    events = map_sdk_message(msg, live, "s1")
    assert [e.type for e in events] == ["error", "done"]
    err = events[0]
    assert err.payload.code == "529"
    assert "overloaded" in err.payload.message
    assert err.payload.retryable is True  # 5xx
    assert events[1].payload.reason == "error"


def test_result_max_turns_reason():
    live = _live()
    msg = sdk.ResultMessage(
        subtype="error_max_turns", duration_ms=1, duration_api_ms=1, is_error=False, num_turns=9,
        session_id="sdk-1", usage={},
    )
    events = map_sdk_message(msg, live, "s1")
    assert events[-1].payload.reason == "max-turns"


def _rate_event(status: str, rtype: str = "five_hour", resets_at: int = 1_720_000_000) -> sdk.RateLimitEvent:
    info = sdk.RateLimitInfo(
        status=status, resets_at=resets_at, rate_limit_type=rtype, utilization=1.0,
        overage_status=None, overage_resets_at=None, overage_disabled_reason=None, raw={},
    )
    return sdk.RateLimitEvent(rate_limit_info=info, uuid="x", session_id="sdk-1")


def test_rejected_ratelimit_maps_to_limit_account_scope():
    live = _live()
    events = map_sdk_message(_rate_event("rejected", "five_hour"), live, "s1")
    assert len(events) == 1
    assert events[0].type == "limit"
    assert events[0].payload.scope == "account"
    assert events[0].payload.resets_at is not None and events[0].payload.resets_at.startswith("20")


def test_allowed_ratelimit_emits_nothing():
    live = _live()
    assert map_sdk_message(_rate_event("allowed"), live, "s1") == []


def test_seq_seeded_from_base():
    live = _live(seq_base=SEQ_BLOCK)
    msg = sdk.AssistantMessage(content=[sdk.TextBlock(text="a"), sdk.TextBlock(text="b")], model="opus")
    events = map_sdk_message(msg, live, "s1")
    assert [e.seq for e in events] == [SEQ_BLOCK, SEQ_BLOCK + 1]


@pytest.mark.parametrize(
    "level,mode",
    [("readonly", "plan"), ("standard", "acceptEdits"), ("trusted", "bypassPermissions")],
)
def test_permission_mode_mapping(level, mode):
    assert _PERMISSION_MODE[level] == mode


def test_build_options_env_persona_and_mode():
    adapter = ClaudeCodeAdapter(Settings())
    options = adapter._build_options(
        scope="backend", repo="omnifield/brainer", cwd="/repo", config_dir="/cfg",
        permission="standard", model="claude-opus-4-8", persona="Be terse.", resume=None,
    )
    assert options.permission_mode == "acceptEdits"
    assert options.cwd == "/repo"
    assert options.model == "claude-opus-4-8"
    assert options.resume is None
    assert options.env["OMNIFIELD_SCOPE"] == "backend"
    assert options.env["CLAUDE_CONFIG_DIR"] == "/cfg"
    assert options.env["CLAUDE_CODE_ENABLE_TELEMETRY"] == "1"
    assert "scope=backend" in options.env["OTEL_RESOURCE_ATTRIBUTES"]
    assert "repo=omnifield/brainer" in options.env["OTEL_RESOURCE_ATTRIBUTES"]
    # persona appends to the default preset, never replaces it.
    assert options.system_prompt == {"type": "preset", "preset": "claude_code", "append": "Be terse."}


class _FakeClient:
    """Minimal ClaudeSDKClient stand-in: query() makes the 'agent' answer via receive_messages()."""

    def __init__(self) -> None:
        self._out: asyncio.Queue = asyncio.Queue()
        self.queried: list[str] = []

    async def query(self, text: str) -> None:
        self.queried.append(text)
        self._out.put_nowait(sdk.AssistantMessage(content=[sdk.TextBlock(text="pong")], model="m"))

    async def receive_messages(self):
        while True:
            yield await self._out.get()


async def test_send_injects_user_message_before_agent_reply():
    # Ф2: send() must put a wire message{role:user} into the stream so it survives replay, ordered
    # before the agent's response, with monotonic seq.
    adapter = ClaudeCodeAdapter(Settings())
    handle = AgentSessionHandle(
        session_id="s1", provider="claude-code", provider_state={"seq_base": 0, "sdk_session_id": "x"}
    )
    adapter._live["s1"] = _LiveSession(client=_FakeClient(), cwd="/r", config_dir=None, seq_base=0, sdk_session_id="x")

    seen: list = []

    async def consume():
        async for event in adapter.stream(handle):
            seen.append(event)
            if len(seen) >= 2:
                break

    task = asyncio.create_task(consume())
    await asyncio.sleep(0)  # let stream() start its SDK pump
    await adapter.send(handle, "ping")
    await asyncio.wait_for(task, 1.0)

    assert seen[0].type == "message" and seen[0].payload.role == "user" and seen[0].payload.text == "ping"
    assert seen[1].type == "message" and seen[1].payload.role == "agent" and seen[1].payload.text == "pong"
    assert seen[0].seq < seen[1].seq  # user reply strictly precedes the response
    assert adapter._live["s1"].client.queried == ["ping"]
