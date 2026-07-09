"""Control channel — the delivery layer between the provider stream and SSE subscribers.

The adapter yields contract `Event`s (seq already stamped). The hub owns one consumer task per
session that buffers events (ring buffer, for Last-Event-ID replay within this process) and fans
them out to SSE subscribers, persists the SDK session id into the registry once known, projects a
coarse status for the list view, and resumes live sessions on start-up (blueprint §1.5, В2).

Delivery-only: event history is NOT persisted (the chater bridge is the history store). Only the
handle — including the monotonic `seq_base` cursor — survives restart, in the kernel registry.
"""

from .hub import ChannelHub, SessionChannel, SessionSummary

__all__ = ["ChannelHub", "SessionChannel", "SessionSummary"]
