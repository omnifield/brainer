"""Operations, permission vocabulary, and the persistable session handle (blueprint §1.3).

`AgentProvider` is the seam every integration implements — the evolution of the old
`backend/app/providers/base.py:IAgentProvider`, moved here per ARCHITECTURE ("вынос = git mv") and
widened with the event channel. The kernel knows NOTHING about any concrete provider: a new
provider is a new `AgentProvider` implementation registered at the consumer (backend), and the
kernel is not touched (purity test enforces this).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .events import Event

# Our permission vocabulary — NOT SDK strings. The adapter maps these onto its own mechanisms
# (blueprint §1.3): SDK values like acceptEdits/bypassPermissions must never cross the boundary,
# because a preset carrying `permissions:` is read by hooks, UI, and a future agent-loop alike.
PermissionLevel = Literal["readonly", "standard", "trusted"]


class AgentSessionHandle(BaseModel):
    """Persistable reference to a session (blueprint §1.3, В2).

    `session_id` is OURS. `provider_state` is opaque adapter JSON (for claude-code:
    sdk_session_id / cwd / config_dir) — the kernel never looks inside it.
    """

    model_config = ConfigDict(extra="forbid")

    session_id: str
    provider: str
    provider_state: dict[str, Any] = Field(default_factory=dict)


class LaunchRequest(BaseModel):
    """Resolved inputs to `launch` (blueprint §1.3: `launch(role, repo, brief?, model?, account?)`).

    The blueprint says launch "берёт роль пресета → из неё permission-уровень, model, persona".
    Preset resolution lives ABOVE the kernel (backend reads `.omnifield/preset.yaml`; that track is
    out of scope here), so the resolved `permission`/`persona` arrive already computed — the kernel
    contract must carry them because they are part of its vocabulary, but it does not derive them.
    `account` is a reserve for the multi-account router (§5); MVP uses one profile.
    """

    model_config = ConfigDict(extra="forbid")

    role: str
    repo: str
    permission: PermissionLevel
    brief: str | None = None
    model: str | None = None
    account: str | None = None
    persona: str | None = None


class AgentProvider(ABC):
    """The agent-as-provider seam. Implementations live at the consumer (backend adapters), never here."""

    name: str

    @abstractmethod
    async def launch(self, request: LaunchRequest) -> AgentSessionHandle:
        """Start a session from resolved launch inputs; return its persistable handle."""

    @abstractmethod
    async def send(self, handle: AgentSessionHandle, text: str) -> None:
        """Send a message into a live session (follow-up in the same context)."""

    @abstractmethod
    def stream(self, handle: AgentSessionHandle) -> AsyncIterator[Event]:
        """Yield the session's events. Consumers dedup/order by `seq`."""

    @abstractmethod
    async def resume(self, handle: AgentSessionHandle) -> AgentSessionHandle:
        """Re-attach to a persisted session after a backend restart (В2); return the (possibly
        refreshed) handle. How this is achieved is the adapter's concern."""

    @abstractmethod
    async def stop(self, handle: AgentSessionHandle, force: bool = False) -> None:
        """Stop the session: soft interrupt, or hard kill when `force=True`."""
