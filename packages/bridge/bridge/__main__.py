"""Runnable entrypoint: wire env → real chater client + claude-code agent → run the bridge.

    uv run python -m bridge

Env (see `config.Settings`): CHATER_URL, AGENT_HANDLE, ROOM_ID (optional), ROOMS_POLL_S,
AGENT_HISTORY_LIMIT, AGENT_TIMEOUT_S. The agent runtime rides the ambient `CLAUDE_CONFIG_DIR`
OAuth — no API key.

`ROOM_ID` set → single-room mode (Step-1 back-compat). Empty → auto mode: discover every room the
agent is a participant of and join new ones as they appear.
"""

from __future__ import annotations

import asyncio
import logging

from .agent import Agent, ClaudeCodeAgent
from .chater import ChaterClient
from .config import Settings
from .loop import Bridge, RoomSupervisor, run_bridge

log = logging.getLogger("brainer.bridge")


def _make_bridge(client: ChaterClient, agent: Agent, settings: Settings, room: object) -> Bridge:
    # One Bridge per room → its own posted-id set (self-echo isolation, no cross-room replies).
    return Bridge(client, agent, room_id=str(room), history_limit=settings.history_limit)


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = Settings()

    client = ChaterClient(settings.chater_url, settings.agent_handle)
    agent = ClaudeCodeAgent(timeout_s=settings.agent_timeout_s)
    try:
        await client.ensure_user()  # idempotent: 409 (already exists) is success, not a crash

        if settings.single_room:
            log.info("bridge up (single-room): handle=%s room=%s", settings.agent_handle, settings.room_id)
            bridge = _make_bridge(client, agent, settings, settings.room_id)
            await run_bridge(bridge, client, settings.ws_url_for(settings.room_id))
        else:
            log.info("bridge up (auto): handle=%s poll=%ss", settings.agent_handle, settings.rooms_poll_s)
            supervisor = RoomSupervisor(
                client,
                make_bridge=lambda room: _make_bridge(client, agent, settings, room),
                ws_url_for=settings.ws_url_for,
                poll_interval_s=settings.rooms_poll_s,
            )
            await supervisor.run()
    finally:
        await client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
