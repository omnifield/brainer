"""IAgentProvider — the agent-as-provider seam (ARCHITECTURE / ADR 078).

A "provider" is one implementation of the agentic-session capability on a concrete resource.
MVP ships exactly one: `claude-code` (external Claude Code process via claude-scope). The
interface is the BASE we extend later (self-hosted agent-loop, peer) — no router/entitlement
now (single provider, dormant). Keep it small: launch / status / activity / stop.
"""

from __future__ import annotations

import subprocess
from abc import ABC, abstractmethod
from dataclasses import dataclass

from ..sessions.models import Activity, SessionStatus


@dataclass
class LaunchHandle:
    """Provider-owned handle to a live session — the seam's currency.

    Carries what both process-control (pid/popen) and telemetry correlation (scope/package/repo)
    need. Kept provider-agnostic in shape so a future provider can populate it differently.
    """

    scope: str
    package: str
    repo: str
    pid: int
    popen: subprocess.Popen | None = None


class IAgentProvider(ABC):
    name: str

    @abstractmethod
    def launch(self, *, repo_name: str, repo_path, scope: str, brief: str | None = None) -> LaunchHandle:
        """Spawn a scoped agent session; return its handle. Sync (process spawn)."""

    @abstractmethod
    async def status(self, handle: LaunchHandle) -> SessionStatus:
        """Current lifecycle status of the session."""

    @abstractmethod
    async def activity(self, handle: LaunchHandle) -> Activity | None:
        """Most recent observed activity, or None if none seen yet."""

    @abstractmethod
    def stop(self, handle: LaunchHandle) -> bool:
        """Terminate the session. Returns True if a stop was issued."""
