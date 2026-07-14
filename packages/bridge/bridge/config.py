"""Env-only settings for the bridge (Step 1 — one agent, one room).

No tokens/keys are baked in: the agent authenticates to chater as a plain participant with a
Bearer handle (chater's v0 identity model), and the agent runtime rides the existing claude-code
OAuth (`CLAUDE_CONFIG_DIR`, injected into the container). We only read env — a missing `ROOM_ID`
is a loud stop-signal (the bridge has nothing to attach to), never a silent default.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


class ConfigError(ValueError):
    """A required env var is missing or malformed — surface it, don't paper over it."""


@dataclass(frozen=True)
class Settings:
    # chater base URL on the docker network; the bridge is an ordinary client of the public API.
    chater_url: str = field(default_factory=lambda: os.environ.get("CHATER_URL", "http://chater:8020").rstrip("/"))
    # ASCII handle the agent participates under; also the Bearer token on the ws upgrade.
    agent_handle: str = field(default_factory=lambda: os.environ.get("AGENT_HANDLE", "claude"))
    # Target room. No default: nothing to bridge without it (Step 1 is single-room by design).
    room_id: str = field(default_factory=lambda: os.environ.get("ROOM_ID", ""))
    # How much recent history to hand the agent as context alongside the triggering message.
    history_limit: int = field(default_factory=lambda: int(os.environ.get("AGENT_HISTORY_LIMIT", "20")))
    # Hard cap on a single agent turn so a stuck run can't wedge the loop forever.
    agent_timeout_s: float = field(default_factory=lambda: float(os.environ.get("AGENT_TIMEOUT_S", "300")))

    def __post_init__(self) -> None:
        if not self.room_id:
            raise ConfigError("ROOM_ID is required (Step 1 bridges exactly one room)")
        if not self.agent_handle.isascii() or not self.agent_handle.strip():
            raise ConfigError(f"AGENT_HANDLE must be a non-blank ASCII handle, got: {self.agent_handle!r}")

    @property
    def ws_url(self) -> str:
        """ws(s):// upgrade URL for the room feed — scheme derived from `chater_url`."""
        base = self.chater_url.replace("http://", "ws://", 1).replace("https://", "wss://", 1)
        return f"{base}/chater/rooms/{self.room_id}/ws"
