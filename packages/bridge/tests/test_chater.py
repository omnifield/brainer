"""chater client against an httpx MockTransport — no real chater.

Guards the exact bug the live test caught: `ensure_user` must treat **409 Conflict** (user already
exists) as success, or the bridge crashes on every restart. Also pins that `post_message` returns
the created message id (the self-echo filter depends on it).
"""

from __future__ import annotations

import httpx
import pytest

from bridge.chater import ChaterClient


def _client(handler) -> ChaterClient:
    return ChaterClient("http://chater:8020", "bridgebot", transport=httpx.MockTransport(handler))


async def test_ensure_user_tolerates_409_conflict():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/chater/users"
        return httpx.Response(409, json={"detail": "handle exists"})

    client = _client(handler)
    try:
        await client.ensure_user()  # must NOT raise — the restart-survival fix
    finally:
        await client.aclose()


async def test_ensure_user_ok_on_201():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(201, json={"id": 4, "handle": "bridgebot"})

    client = _client(handler)
    try:
        await client.ensure_user()
    finally:
        await client.aclose()


async def test_ensure_user_still_raises_on_500():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"detail": "boom"})

    client = _client(handler)
    try:
        with pytest.raises(httpx.HTTPStatusError):
            await client.ensure_user()
    finally:
        await client.aclose()


async def test_post_message_returns_created_id():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/chater/rooms/3/messages"
        return httpx.Response(201, json={"id": 777, "body": "hi"})

    client = _client(handler)
    try:
        mid = await client.post_message("3", "hi")
        assert mid == 777
    finally:
        await client.aclose()


async def test_list_rooms_parses_objects_bare_ids_and_wrapped():
    payloads = iter(
        [
            [{"id": 1}, {"id": 2}],  # list of objects
            [3, 4],  # list of bare ids
            {"rooms": [{"id": 5}]},  # wrapped envelope
        ]
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/chater/rooms"
        return httpx.Response(200, json=next(payloads))

    client = _client(handler)
    try:
        assert await client.list_rooms() == [1, 2]
        assert await client.list_rooms() == [3, 4]
        assert await client.list_rooms() == [5]
    finally:
        await client.aclose()


async def test_recent_messages_parses_list_and_wrapped():
    payloads = iter(
        [
            [{"id": 1, "author_id": 2, "body": "a"}],  # bare list
            {"messages": [{"id": 3, "author_id": 4, "body": "b"}]},  # wrapped
        ]
    )

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=next(payloads))

    client = _client(handler)
    try:
        first = await client.recent_messages("3", limit=10)
        assert [m.id for m in first] == [1]
        second = await client.recent_messages("3", limit=10)
        assert [m.body for m in second] == ["b"]
    finally:
        await client.aclose()
