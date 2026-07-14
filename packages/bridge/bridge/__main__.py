"""Runnable entrypoint: wire env → real chater client + claude-code agent → run the loop.

    uv run python -m bridge

Env (see `config.Settings`): CHATER_URL, AGENT_HANDLE, ROOM_ID (required), AGENT_HISTORY_LIMIT,
AGENT_TIMEOUT_S. The agent runtime rides the ambient `CLAUDE_CONFIG_DIR` OAuth — no API key.
"""

from __future__ import annotations

import asyncio
import logging

from .agent import ClaudeCodeAgent
from .chater import ChaterClient
from .config import Settings
from .loop import Bridge, run_bridge


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = Settings()

    client = ChaterClient(settings.chater_url, settings.agent_handle)
    agent = ClaudeCodeAgent(timeout_s=settings.agent_timeout_s)
    try:
        await client.ensure_user()  # idempotent: 409 (already exists) is success, not a crash
        logging.getLogger("brainer.bridge").info(
            "bridge up: handle=%s room=%s", settings.agent_handle, settings.room_id
        )
        bridge = Bridge(
            client,
            agent,
            room_id=settings.room_id,
            history_limit=settings.history_limit,
        )
        await run_bridge(bridge, client, settings.ws_url)
    finally:
        await client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
