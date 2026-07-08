"""omnifield-kernel — agent-as-provider seam.

Provider-agnostic contract of an agent session: the event vocabulary, the provider operations, the
persistable handle, and the session registry. This is OUR ecosystem-native contract; integrations
(claude-code and future providers) map into it. Zero knowledge of any concrete provider or vendor
SDK — the boundary the purity test guards.
"""

from __future__ import annotations

from .contract import (
    AgentProvider,
    AgentSessionHandle,
    LaunchRequest,
    PermissionLevel,
)
from .events import (
    EVENT_TYPES,
    DoneEvent,
    DonePayload,
    ErrorEvent,
    ErrorPayload,
    Event,
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
    event_adapter,
)
from .registry import SessionStore, StoredSession

__version__ = "0.1.0"

__all__ = [
    # contract
    "AgentProvider",
    "AgentSessionHandle",
    "LaunchRequest",
    "PermissionLevel",
    # events
    "Event",
    "event_adapter",
    "EVENT_TYPES",
    "MessageEvent",
    "MessagePayload",
    "ThinkingEvent",
    "ThinkingPayload",
    "ToolCallEvent",
    "ToolCallPayload",
    "ToolResultEvent",
    "ToolResultPayload",
    "StatusEvent",
    "StatusPayload",
    "DoneEvent",
    "DonePayload",
    "Usage",
    "ErrorEvent",
    "ErrorPayload",
    "LimitEvent",
    "LimitPayload",
    "PermissionRequestEvent",
    "PermissionRequestPayload",
    # registry
    "SessionStore",
    "StoredSession",
]
