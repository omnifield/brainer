"""The bridge loop — agent = live participant of one chater room.

Two concerns, kept separate so the decision logic is testable without sockets or a real agent:

* `Bridge.handle_frame` — the per-frame decision: ignore non-messages, **ignore frames whose id is
  one we posted** (else the agent's reply re-triggers it forever — the critical self-echo cut),
  otherwise build a prompt from recent history + the triggering message, run the agent, and post
  exactly one reply, remembering that reply's id.
* `run_bridge` — the supervisor: subscribe to the ws, pump frames through the bridge, and reconnect
  with backoff on drop. Agent/network errors are logged and swallowed so one bad turn never kills
  the process (resilience DoD).

Self-echo is filtered by **our own posted message-ids**, not by author_id: chater's `ensure_user`
returns no id on a 409 (existing user), so relying on author_id would force a chater change and
crash on restart. The ws only pushes *new* messages after connect, so a bounded recent-id set is
enough (forgetting old ids across restarts is harmless — those messages never replay).
"""

from __future__ import annotations

import asyncio
import logging
from collections import deque

from .agent import Agent
from .chater import ChaterClient, Message

logger = logging.getLogger("brainer.bridge")


class _RecentIds:
    """A bounded set of recently-posted message-ids — membership test + FIFO eviction, O(1)."""

    def __init__(self, cap: int = 256) -> None:
        self._cap = cap
        self._order: deque = deque()
        self._set: set = set()

    def add(self, mid: object) -> None:
        if mid is None or mid in self._set:
            return
        self._set.add(mid)
        self._order.append(mid)
        if len(self._order) > self._cap:
            self._set.discard(self._order.popleft())

    def __contains__(self, mid: object) -> bool:
        return mid in self._set


def build_prompt(history: list[Message], trigger: Message) -> str:
    """Recent room history as context, then the message that just arrived as the ask.

    `history` is the tail from chater (may or may not already include `trigger`); we render it
    verbatim as `author:body` lines and append the trigger last so the agent always sees it as the
    current turn even if the history fetch raced ahead of / behind it.
    """
    lines = [f"{m.author_id}: {m.body}" for m in history if m.id != trigger.id]
    context = "\n".join(lines)
    preamble = (
        "You are a participant in a group chat. Below is recent context, then the latest message "
        "addressed to the room. Reply with just your message — no preamble, no quoting.\n"
    )
    ctx_block = f"\n--- recent context ---\n{context}\n" if context else ""
    return f"{preamble}{ctx_block}\n--- latest message ---\n{trigger.author_id}: {trigger.body}\n\nYour reply:"


class Bridge:
    """Turns incoming room frames into at-most-one agent reply each."""

    def __init__(
        self,
        client: ChaterClient,
        agent: Agent,
        *,
        room_id: str,
        history_limit: int = 20,
    ) -> None:
        self._client = client
        self._agent = agent
        self._room_id = room_id
        self._history_limit = history_limit
        self._posted = _RecentIds()

    async def handle_frame(self, frame: dict) -> bool:
        """Process one ws frame. Returns True iff a reply was posted (used by tests)."""
        if frame.get("type") != "message":
            return False
        msg = Message.from_wire(frame.get("message", {}))

        # Critical: never react to a message we posted, or the reply echoes into an infinite loop.
        if msg.id in self._posted:
            return False

        try:
            history = await self._client.recent_messages(self._room_id, limit=self._history_limit)
            reply = await self._agent.respond(build_prompt(history, msg))
        except Exception:  # noqa: BLE001 — one bad turn must not kill the loop
            logger.exception("agent turn failed for message id=%s", msg.id)
            return False

        if not reply.strip():
            logger.info("agent returned empty reply for message id=%s; not posting", msg.id)
            return False

        try:
            posted_id = await self._client.post_message(self._room_id, reply)
        except Exception:  # noqa: BLE001
            logger.exception("failed to post reply for message id=%s", msg.id)
            return False
        self._posted.add(posted_id)
        return True


async def run_bridge(
    bridge: Bridge,
    client: ChaterClient,
    ws_url: str,
    *,
    reconnect_delay_s: float = 3.0,
    stop: asyncio.Event | None = None,
) -> None:
    """Subscribe → pump frames → reconnect on drop, until `stop` is set (never, by default)."""
    while stop is None or not stop.is_set():
        try:
            async with client.subscribe(ws_url) as frames:
                logger.info("bridge connected to %s", ws_url)
                async for frame in frames:
                    await bridge.handle_frame(frame)
                    if stop is not None and stop.is_set():
                        return
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — a dropped/failed ws must lead to a reconnect, not a crash
            logger.exception("ws connection lost; reconnecting in %.1fs", reconnect_delay_s)
        if stop is not None and stop.is_set():
            return
        await asyncio.sleep(reconnect_delay_s)
