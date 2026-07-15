"""RoomSupervisor auto-discovery — through the real Bridge/run_bridge, faking only chater I/O.

Covers the Step-2 DoD:
  * a new room in the poll result → a subscription is opened;
  * a room that drops out of the poll result → its subscription is closed;
  * posted-id self-echo state is isolated per room (no cross-room suppression, no cross-room reply).
"""

from __future__ import annotations

import asyncio
import contextlib

from bridge.loop import Bridge, RoomSupervisor


class StubAgent:
    def __init__(self, reply: str = "pong") -> None:
        self.reply = reply
        self.calls = 0

    async def respond(self, prompt: str) -> str:
        self.calls += 1
        return self.reply


class FakeChater:
    """Controllable chater at the boundary: a mutable room list + a frame queue per room."""

    def __init__(self, rooms: list | None = None) -> None:
        self.rooms = rooms or []
        self._queues: dict[str, asyncio.Queue] = {}
        self.active: set[str] = set()  # currently-open subscriptions (by room key)
        self.opened: list[str] = []  # every subscription ever opened
        self.posts: list[tuple[str, str]] = []
        self._next_id = 1000

    async def list_rooms(self) -> list:
        return list(self.rooms)

    async def recent_messages(self, room_id, *, limit):
        return []

    async def post_message(self, room_id, body) -> int:
        self.posts.append((str(room_id), body))
        self._next_id += 1
        return self._next_id

    def queue_for(self, room) -> asyncio.Queue:
        return self._queues.setdefault(str(room), asyncio.Queue())

    @contextlib.asynccontextmanager
    async def subscribe(self, ws_url: str):
        room = ws_url.rsplit("/", 1)[-1]
        self.active.add(room)
        self.opened.append(room)
        try:
            yield self._drain(self.queue_for(room))
        finally:
            self.active.discard(room)

    async def _drain(self, q: asyncio.Queue):
        while True:
            yield await q.get()


def _peer_frame(body: str, *, mid: int, author: int = 1) -> dict:
    return {"type": "message", "message": {"id": mid, "author_id": author, "body": body}}


def _supervisor(fake: FakeChater, agent: StubAgent) -> RoomSupervisor:
    return RoomSupervisor(
        fake,
        make_bridge=lambda room: Bridge(fake, agent, room_id=str(room), history_limit=10),
        ws_url_for=lambda room: f"ws://x/{room}",
        poll_interval_s=0.01,
    )


async def _until(pred, timeout: float = 2.0) -> None:
    async with asyncio.timeout(timeout):
        while not pred():
            await asyncio.sleep(0.005)


async def test_new_room_gets_subscribed():
    fake = FakeChater(rooms=[1, 2])
    sup = _supervisor(fake, StubAgent())
    try:
        await sup._poll_once()
        assert sup.active_rooms == {1, 2}
        await _until(lambda: fake.active == {"1", "2"})
    finally:
        await sup._shutdown_all()
    assert fake.active == set()  # shutdown closed every subscription


async def test_room_removed_from_poll_is_unsubscribed():
    fake = FakeChater(rooms=[1, 2])
    sup = _supervisor(fake, StubAgent())
    try:
        await sup._poll_once()
        await _until(lambda: fake.active == {"1", "2"})

        fake.rooms = [1]  # room 2 no longer a member
        await sup._poll_once()

        assert sup.active_rooms == {1}
        await _until(lambda: fake.active == {"1"})
    finally:
        await sup._shutdown_all()


async def test_appears_between_polls_is_picked_up():
    fake = FakeChater(rooms=[1])
    sup = _supervisor(fake, StubAgent())
    try:
        await sup._poll_once()
        await _until(lambda: fake.active == {"1"})

        fake.rooms = [1, 2]  # user added the bot to a new room
        await sup._poll_once()

        assert sup.active_rooms == {1, 2}
        await _until(lambda: "2" in fake.active)
    finally:
        await sup._shutdown_all()


async def test_reply_goes_to_the_same_room_only():
    fake = FakeChater(rooms=[1, 2])
    sup = _supervisor(fake, StubAgent(reply="pong"))
    try:
        await sup._poll_once()
        await _until(lambda: fake.active == {"1", "2"})

        fake.queue_for(1).put_nowait(_peer_frame("ping", mid=5))
        await _until(lambda: len(fake.posts) == 1)

        assert fake.posts == [("1", "pong")]  # reply went to room 1, never room 2
    finally:
        await sup._shutdown_all()


async def test_posted_id_is_isolated_per_room():
    # Room 1 posts a reply (id=1001). That id echoing in room 1 is ignored (own echo), but the SAME
    # id arriving in room 2 is a foreign message there → room 2 replies. Proves per-room posted sets.
    fake = FakeChater(rooms=[1, 2])
    sup = _supervisor(fake, StubAgent(reply="pong"))
    try:
        await sup._poll_once()
        await _until(lambda: fake.active == {"1", "2"})

        fake.queue_for(1).put_nowait(_peer_frame("ping", mid=5))
        await _until(lambda: len(fake.posts) == 1)
        posted_id = 1001  # FakeChater assigns 1000+n; first post → 1001

        # echo in room 1 → suppressed
        fake.queue_for(1).put_nowait(_peer_frame("pong", mid=posted_id))
        # same id in room 2 → NOT suppressed (isolated set) → a second post, this time in room 2
        fake.queue_for(2).put_nowait(_peer_frame("pong", mid=posted_id))

        await _until(lambda: len(fake.posts) == 2)
        assert fake.posts == [("1", "pong"), ("2", "pong")]
    finally:
        await sup._shutdown_all()


async def test_failed_poll_keeps_existing_subscriptions():
    fake = FakeChater(rooms=[1])
    sup = _supervisor(fake, StubAgent())
    try:
        await sup._poll_once()
        await _until(lambda: fake.active == {"1"})

        async def boom():
            raise RuntimeError("chater down")

        fake.list_rooms = boom  # next poll fails
        await sup._poll_once()  # must not raise, must not drop room 1

        assert sup.active_rooms == {1}
        assert fake.active == {"1"}
    finally:
        await sup._shutdown_all()
