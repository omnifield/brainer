"""Loop logic against a stubbed chater client + stubbed agent — no sockets, no subprocess.

The two things that matter for Step 1:
  * self-echo is filtered (a frame whose id we posted → nothing happens), so the agent never
    re-triggers itself;
  * one incoming message → exactly one POST back (with the agent's reply), and empty/failed turns POST nothing.
"""

from __future__ import annotations

import asyncio

from bridge.chater import Message
from bridge.loop import Bridge, build_prompt, run_bridge

PEER_ID = 1
POST_ID = 500  # id the stub assigns to whatever the bridge posts


class StubClient:
    """Records posts; serves a fixed history. Matches the ChaterClient surface the loop touches."""

    def __init__(self, history: list[Message] | None = None, *, post_id: object = POST_ID) -> None:
        self.history = history or []
        self.posts: list[tuple[str, str]] = []
        self.recent_calls = 0
        self._post_id = post_id

    async def recent_messages(self, room_id: str, *, limit: int) -> list[Message]:
        self.recent_calls += 1
        return self.history

    async def post_message(self, room_id: str, body: str) -> object:
        self.posts.append((room_id, body))
        return self._post_id


class StubAgent:
    """Returns a canned reply (or raises) and records the prompts it saw."""

    def __init__(self, reply: str = "hi from agent", *, raises: bool = False) -> None:
        self.reply = reply
        self.raises = raises
        self.prompts: list[str] = []

    async def respond(self, prompt: str) -> str:
        self.prompts.append(prompt)
        if self.raises:
            raise RuntimeError("boom")
        return self.reply


def _frame(author_id: object, body: str, *, mid: int = 100, type_: str = "message") -> dict:
    return {"type": type_, "message": {"id": mid, "room_id": "1", "author_id": author_id, "body": body}}


def _bridge(client: StubClient, agent: StubAgent) -> Bridge:
    return Bridge(client, agent, room_id="1", history_limit=20)


async def test_self_posted_echo_is_ignored():
    # A peer message triggers one reply (posted as POST_ID); when that reply echoes back on the ws
    # as a frame with the same id, the bridge must ignore it — no second agent turn, no second post.
    client, agent = StubClient(post_id=POST_ID), StubAgent(reply="pong")
    bridge = _bridge(client, agent)

    posted = await bridge.handle_frame(_frame(PEER_ID, "ping", mid=1))
    assert posted is True
    assert client.posts == [("1", "pong")]

    echo = await bridge.handle_frame(_frame(agent.reply, "pong", mid=POST_ID))
    assert echo is False
    assert client.posts == [("1", "pong")]  # unchanged — echo did not re-trigger
    assert len(agent.prompts) == 1  # agent never ran on our own echo


async def test_peer_message_yields_exactly_one_post():
    client, agent = StubClient(), StubAgent(reply="pong")
    posted = await _bridge(client, agent).handle_frame(_frame(PEER_ID, "ping"))
    assert posted is True
    assert client.posts == [("1", "pong")]
    assert len(agent.prompts) == 1


async def test_non_message_frames_are_skipped():
    client, agent = StubClient(), StubAgent()
    posted = await _bridge(client, agent).handle_frame(_frame(PEER_ID, "x", type_="presence"))
    assert posted is False
    assert client.posts == []


async def test_empty_reply_is_not_posted():
    client, agent = StubClient(), StubAgent(reply="   ")
    posted = await _bridge(client, agent).handle_frame(_frame(PEER_ID, "ping"))
    assert posted is False
    assert client.posts == []


async def test_agent_failure_does_not_post_or_raise():
    client, agent = StubClient(), StubAgent(raises=True)
    posted = await _bridge(client, agent).handle_frame(_frame(PEER_ID, "ping"))
    assert posted is False
    assert client.posts == []


def test_build_prompt_includes_context_and_drops_duplicate_trigger():
    trigger = Message(id=100, author_id=PEER_ID, body="ping")
    history = [Message(id=99, author_id=2, body="earlier"), trigger]
    prompt = build_prompt(history, trigger)
    assert "earlier" in prompt
    assert "ping" in prompt
    # trigger appears once (as the latest message), not duplicated from history
    assert prompt.count("ping") == 1


def test_build_prompt_without_history_still_has_trigger():
    trigger = Message(id=1, author_id=PEER_ID, body="hello")
    prompt = build_prompt([], trigger)
    assert "hello" in prompt
    assert "--- recent context ---" not in prompt


# ---- supervisor: pumps frames, then stops cleanly ----


class OneShotClient(StubClient):
    """A subscribe() that yields a fixed frame list once, then ends (simulates a ws session)."""

    def __init__(self, frames: list[dict], history: list[Message] | None = None) -> None:
        super().__init__(history)
        self._frames = frames

    def subscribe(self, ws_url: str):
        frames = self._frames

        class _Ctx:
            async def __aenter__(self):
                async def gen():
                    for f in frames:
                        yield f

                return gen()

            async def __aexit__(self, *exc):
                return False

        return _Ctx()


async def test_run_bridge_pumps_frames_then_stops():
    # peer ping (mid=2) → one reply posted as POST_ID; the reply's echo (mid=POST_ID) is filtered.
    frames = [_frame(PEER_ID, "ping", mid=2), _frame(PEER_ID, "pong", mid=POST_ID)]
    client, agent = OneShotClient(frames), StubAgent(reply="pong")
    bridge = _bridge(client, agent)
    stop = asyncio.Event()

    async def stopper():
        # let one connection drain, then stop before the reconnect sleep elapses
        while len(client.posts) < 1:
            await asyncio.sleep(0)
        stop.set()

    await asyncio.wait_for(
        asyncio.gather(run_bridge(bridge, client, "ws://x", reconnect_delay_s=0.01, stop=stop), stopper()),
        timeout=2,
    )
    # exactly one post; the echoed reply frame did not re-trigger
    assert client.posts == [("1", "pong")]
