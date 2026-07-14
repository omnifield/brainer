"""chater client — the bridge as an ordinary participant over chater's public v0 API.

chater knows nothing about agents; this is just REST + a ws subscription. Auth is chater's v0
model: a Bearer handle identifies the participant (no query-token — the bridge is not a browser,
so it sends the header on the ws upgrade). Kept deliberately small: ensure identity, read recent
history, post a reply, stream the room. Nothing here decides *whether* to reply — that is the loop.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import httpx
import websockets

from .trace import aspan


@dataclass(frozen=True)
class Message:
    """One chater message as the loop cares about it (extra fields on the wire are ignored)."""

    id: Any
    author_id: Any
    body: str

    @classmethod
    def from_wire(cls, data: dict[str, Any]) -> Message:
        return cls(id=data.get("id"), author_id=data.get("author_id"), body=data.get("body", ""))


class ChaterClient:
    """REST + ws over chater's public API. One instance per bridge process."""

    def __init__(
        self, base_url: str, handle: str, *, timeout: float = 15.0, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._base = base_url.rstrip("/")
        self._handle = handle
        self._http = httpx.AsyncClient(
            base_url=self._base,
            headers={"Authorization": f"Bearer {handle}"},
            timeout=timeout,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def ensure_user(self) -> None:
        """Ensure the agent participant exists in chater — idempotent, safe on every boot.

        `POST /chater/users {handle}` creates the user; on a restart the user already persists, so
        chater answers **409 Conflict** — that is success, not a crash (the earlier version raised
        here and died on every second boot; caught by the live test). We do NOT read an author_id
        back: self-echo is filtered by our own posted message-ids (see `loop.Bridge`), so a 409 with
        no id in its body is harmless and chater needs no change.
        """
        async with aspan("chater.ensure_user", handle=self._handle):
            resp = await self._http.post("/chater/users", json={"handle": self._handle})
            if resp.status_code == httpx.codes.CONFLICT:
                return  # already exists — idempotent
            resp.raise_for_status()

    async def recent_messages(self, room_id: str, *, limit: int) -> list[Message]:
        async with aspan("chater.recent_messages", room=room_id, limit=limit):
            resp = await self._http.get(f"/chater/rooms/{room_id}/messages", params={"limit": limit})
            resp.raise_for_status()
            payload = resp.json()
            items = payload if isinstance(payload, list) else payload.get("messages", [])
            return [Message.from_wire(m) for m in items]

    async def post_message(self, room_id: str, body: str) -> Any:
        """Post a reply; return the created message's id so the loop can ignore its own echo."""
        async with aspan("chater.post_message", room=room_id):
            resp = await self._http.post(f"/chater/rooms/{room_id}/messages", json={"body": body})
            resp.raise_for_status()
            return resp.json().get("id")

    @asynccontextmanager
    async def subscribe(self, ws_url: str) -> AsyncIterator[AsyncIterator[dict[str, Any]]]:
        """Open the room ws and yield an async iterator of decoded frames.

        The bridge is not a browser, so the participant Bearer rides the upgrade as a header
        (chater accepts header auth on ws; query-token is the browser path). Non-JSON / non-dict
        frames are skipped rather than crashing the stream.
        """
        headers = {"Authorization": f"Bearer {self._handle}"}
        async with websockets.connect(ws_url, additional_headers=headers) as ws:
            yield _iter_frames(ws)


async def _iter_frames(ws: Any) -> AsyncIterator[dict[str, Any]]:
    import json

    async for raw in ws:
        try:
            frame = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(frame, dict):
            yield frame
