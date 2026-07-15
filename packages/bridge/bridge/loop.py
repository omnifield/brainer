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
import contextlib
import logging
from collections import deque
from collections.abc import Callable

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


class RoomSupervisor:
    """Auto-discovery mode: one `Bridge` + ws subscription per room, driven by `GET /chater/rooms`.

    chater does not push the room list over ws, so we poll it every `poll_interval_s`. Each room
    gets its **own** `Bridge` — therefore its own posted-id set, so self-echo filtering is isolated
    per room and a reply never crosses rooms. Rooms are added/removed as the poll result changes:

    * a newly-appeared room → spawn a per-room task running `run_bridge` (its own reconnect loop);
    * a room that dropped out of the list → cancel its task and clean up;
    * a per-room task that died unexpectedly → reaped and re-subscribed on the next poll.

    Resilience: a failed poll keeps the current subscriptions (logged, not fatal); one room's task
    failure never touches another room's; the whole thing runs until `stop` is set.
    """

    def __init__(
        self,
        client: ChaterClient,
        *,
        make_bridge: Callable[[object], Bridge],
        ws_url_for: Callable[[object], str],
        poll_interval_s: float = 10.0,
        reconnect_delay_s: float = 3.0,
    ) -> None:
        self._client = client
        self._make_bridge = make_bridge
        self._ws_url_for = ws_url_for
        self._poll_interval_s = poll_interval_s
        self._reconnect_delay_s = reconnect_delay_s
        self._tasks: dict[object, asyncio.Task] = {}

    @property
    def active_rooms(self) -> set[object]:
        return set(self._tasks)

    async def run(self, stop: asyncio.Event | None = None) -> None:
        try:
            while stop is None or not stop.is_set():
                await self._poll_once()
                await self._sleep_or_stop(self._poll_interval_s, stop)
        finally:
            await self._shutdown_all()

    async def _poll_once(self) -> None:
        self._reap_finished()
        try:
            rooms = await self._client.list_rooms()
        except Exception:  # noqa: BLE001 — a failed poll must not drop live subscriptions or crash
            logger.exception("room discovery poll failed; keeping current subscriptions")
            return
        current = set(rooms)
        for room in current - set(self._tasks):
            self._start_room(room)
        for room in set(self._tasks) - current:
            await self._stop_room(room)

    def _start_room(self, room: object) -> None:
        bridge = self._make_bridge(room)
        task = asyncio.create_task(
            run_bridge(bridge, self._client, self._ws_url_for(room), reconnect_delay_s=self._reconnect_delay_s),
            name=f"room-{room}",
        )
        self._tasks[room] = task
        logger.info("subscribed to room %s", room)

    async def _stop_room(self, room: object) -> None:
        task = self._tasks.pop(room, None)
        if task is None:
            return
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        logger.info("unsubscribed from room %s", room)

    def _reap_finished(self) -> None:
        """Drop tasks that ended on their own so a still-listed room is re-subscribed next poll."""
        for room, task in list(self._tasks.items()):
            if not task.done():
                continue
            if not task.cancelled() and (exc := task.exception()) is not None:
                logger.error("room %s task crashed: %r; will re-subscribe", room, exc)
            self._tasks.pop(room, None)

    async def _sleep_or_stop(self, delay: float, stop: asyncio.Event | None) -> None:
        if stop is None:
            await asyncio.sleep(delay)
            return
        with contextlib.suppress(asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=delay)

    async def _shutdown_all(self) -> None:
        for room in list(self._tasks):
            await self._stop_room(room)
