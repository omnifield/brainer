"""Event vocabulary: all 9 types round-trip through the wire adapter, discriminator picks the right
variant, and the strict contract rejects unknown fields."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from omnifield_kernel import EVENT_TYPES, event_adapter
from omnifield_kernel.events import (
    DoneEvent,
    DonePayload,
    ErrorEvent,
    ErrorPayload,
    LimitEvent,
    LimitPayload,
    MessageEvent,
    MessagePayload,
    PermissionRequestEvent,
    PermissionRequestPayload,
    StatusEvent,
    StatusPayload,
    ThinkingEvent,
    ThinkingPayload,
    ToolCallEvent,
    ToolCallPayload,
    ToolResultEvent,
    ToolResultPayload,
    Usage,
)

_ENV = {"session_id": "s-1", "seq": 1, "ts": "2026-07-08T12:00:00Z"}

ONE_OF_EACH = [
    MessageEvent(**_ENV, payload=MessagePayload(role="agent", text="hi", partial=True)),
    ThinkingEvent(**_ENV, payload=ThinkingPayload(text="reasoning")),
    ToolCallEvent(**_ENV, payload=ToolCallPayload(call_id="c1", tool="Read", input={"path": "a"})),
    ToolResultEvent(**_ENV, payload=ToolResultPayload(call_id="c1", output="ok", is_error=False)),
    StatusEvent(**_ENV, payload=StatusPayload(state="running", detail=None)),
    DoneEvent(**_ENV, payload=DonePayload(reason="completed", usage=Usage(input_tokens=10, output_tokens=20))),
    ErrorEvent(**_ENV, payload=ErrorPayload(code="boom", message="x", retryable=True)),
    LimitEvent(**_ENV, payload=LimitPayload(scope="rate", resets_at="2026-07-08T13:00:00Z")),
    PermissionRequestEvent(**_ENV, payload=PermissionRequestPayload(request_id="r1", tool="Bash", input={})),
]


def test_covers_the_nine_contract_types():
    assert {e.type for e in ONE_OF_EACH} == set(EVENT_TYPES)
    assert len(EVENT_TYPES) == 9


@pytest.mark.parametrize("event", ONE_OF_EACH, ids=[e.type for e in ONE_OF_EACH])
def test_round_trip_python_and_json(event):
    # dict round-trip
    assert event_adapter.validate_python(event.model_dump()) == event
    # json round-trip
    assert event_adapter.validate_json(event.model_dump_json()) == event


@pytest.mark.parametrize("event", ONE_OF_EACH, ids=[e.type for e in ONE_OF_EACH])
def test_discriminator_selects_variant(event):
    parsed = event_adapter.validate_python(event.model_dump())
    assert type(parsed) is type(event)
    assert parsed.type == event.type


def test_unknown_field_is_rejected():
    bad = {**_ENV, "type": "message", "payload": {"role": "agent", "text": "hi"}, "extra": 1}
    with pytest.raises(ValidationError):
        event_adapter.validate_python(bad)


def test_unknown_payload_field_is_rejected():
    bad = {**_ENV, "type": "thinking", "payload": {"text": "t", "mood": "happy"}}
    with pytest.raises(ValidationError):
        event_adapter.validate_python(bad)


def test_unknown_event_type_is_rejected():
    bad = {**_ENV, "type": "telepathy", "payload": {}}
    with pytest.raises(ValidationError):
        event_adapter.validate_python(bad)
