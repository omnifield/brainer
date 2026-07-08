"""Event vocabulary — the wire format of an agent session (blueprint §1.2, as-is).

Provider-agnostic: this is OUR contract; integrations (claude-code and future providers) map
INTO it, never the reverse. Wire casing is snake_case exactly as the blueprint envelope shows
(`session_id`, `call_id`, `is_error`, `input_tokens`, `resets_at`, `request_id`) — this is a fresh
ecosystem-native contract, distinct from the legacy camelCase interface-mvp models in backend.

The Pydantic models here are the SINGLE SOURCE for the wire format; `schema.py` generates the
JSON Schema artifact from them and a test guards against drift (frontend generates TS from that
schema). Adding/removing an event type or payload field is an architect decision — do not extend
here without a brief (see README "Boundary").
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


class _Strict(BaseModel):
    # A contract is authoritative: reject unknown fields so drift surfaces loudly instead of
    # silently riding along on the wire.
    model_config = ConfigDict(extra="forbid")


# ---- payloads (one per event type) ----


class MessagePayload(_Strict):
    role: Literal["agent", "user"]
    text: str
    # partial=True marks a token-streaming chunk; v0 may emit whole messages only, but the field
    # is in the schema from day one so enabling streaming later is not a contract change.
    partial: bool | None = None


class ThinkingPayload(_Strict):
    text: str


class ToolCallPayload(_Strict):
    call_id: str
    tool: str
    input: dict[str, Any]


class ToolResultPayload(_Strict):
    call_id: str
    output: Any
    is_error: bool


class StatusPayload(_Strict):
    # lifecycle of a session; `waiting` = the agent is blocked on input.
    state: Literal["starting", "running", "waiting", "stopped"]
    detail: str | None = None


class Usage(_Strict):
    input_tokens: int
    output_tokens: int
    cost_usd: float | None = None


class DonePayload(_Strict):
    # End of a turn, NOT end of the session.
    reason: Literal["completed", "max-turns", "stopped", "error"]
    usage: Usage


class ErrorPayload(_Strict):
    code: str
    message: str
    retryable: bool


class LimitPayload(_Strict):
    # typed so a router fail-over stays provider-agnostic (blueprint §5, dormant).
    scope: Literal["account", "rate"]
    resets_at: str | None = None


class PermissionRequestPayload(_Strict):
    # Reserved (answers-brief В1). claude-code does not emit this in MVP; the adapter will start
    # emitting it from the SDK can_use_tool callback when permission-forwarding lands.
    request_id: str
    tool: str
    input: dict[str, Any]


# ---- events (envelope + typed payload, discriminated on `type`) ----


class _Envelope(_Strict):
    session_id: str
    # Monotonic per session: reconnect dedup for the stream and ordering for the chater bridge.
    seq: int
    ts: str  # ISO-8601 UTC, e.g. "2026-07-08T12:00:00Z"


class MessageEvent(_Envelope):
    type: Literal["message"] = "message"
    payload: MessagePayload


class ThinkingEvent(_Envelope):
    type: Literal["thinking"] = "thinking"
    payload: ThinkingPayload


class ToolCallEvent(_Envelope):
    type: Literal["tool-call"] = "tool-call"
    payload: ToolCallPayload


class ToolResultEvent(_Envelope):
    type: Literal["tool-result"] = "tool-result"
    payload: ToolResultPayload


class StatusEvent(_Envelope):
    type: Literal["status"] = "status"
    payload: StatusPayload


class DoneEvent(_Envelope):
    type: Literal["done"] = "done"
    payload: DonePayload


class ErrorEvent(_Envelope):
    type: Literal["error"] = "error"
    payload: ErrorPayload


class LimitEvent(_Envelope):
    type: Literal["limit"] = "limit"
    payload: LimitPayload


class PermissionRequestEvent(_Envelope):
    type: Literal["permission-request"] = "permission-request"
    payload: PermissionRequestPayload


Event = Annotated[
    MessageEvent
    | ThinkingEvent
    | ToolCallEvent
    | ToolResultEvent
    | StatusEvent
    | DoneEvent
    | ErrorEvent
    | LimitEvent
    | PermissionRequestEvent,
    Field(discriminator="type"),
]
"""The 9 contract event types as a discriminated union. Parse untyped input with `event_adapter`."""

event_adapter: TypeAdapter[Event] = TypeAdapter(Event)
"""Validate/serialize wire events: `event_adapter.validate_python(dict)` / `.dump_json(event)`."""

# The literal set of contract event types — one place tests and consumers can assert against.
EVENT_TYPES: tuple[str, ...] = (
    "message",
    "thinking",
    "tool-call",
    "tool-result",
    "status",
    "done",
    "error",
    "limit",
    "permission-request",
)
