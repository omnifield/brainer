"""Agent runtime — headless claude-code over the existing OAuth creds.

Step-1 choice: **subprocess `claude -p "<prompt>"`**, stdout = the reply. Rationale — the minimal
runnable for a stateless prompt→reply per message: no session lifecycle to own, no API key (there
is none; only claude-code OAuth via `CLAUDE_CONFIG_DIR`, inherited from the container env). The
richer `claude-agent-sdk` path (live context, resume) is the generalization that lands when this
folds into kernel/orchestrator — out of scope for one agent / one room.

Any failure (non-zero exit, timeout) raises; the loop logs it and stays alive (resilience DoD).
"""

from __future__ import annotations

import asyncio
from typing import Protocol

from .trace import aspan


class Agent(Protocol):
    """The one thing the loop needs: turn a prompt into a reply string."""

    async def respond(self, prompt: str) -> str: ...


class AgentError(RuntimeError):
    """The agent run failed (non-zero exit, timeout, or empty binary)."""


class ClaudeCodeAgent:
    """Runs `claude -p <prompt>` headless and returns stdout, on the ambient OAuth creds."""

    def __init__(self, *, timeout_s: float = 300.0, binary: str = "claude") -> None:
        self._timeout_s = timeout_s
        self._binary = binary

    async def respond(self, prompt: str) -> str:
        async with aspan("agent.respond", chars=len(prompt)):
            proc = await asyncio.create_subprocess_exec(
                self._binary,
                "-p",
                prompt,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=self._timeout_s)
            except TimeoutError as exc:
                proc.kill()
                await proc.wait()
                raise AgentError(f"agent timed out after {self._timeout_s}s") from exc

            if proc.returncode != 0:
                detail = stderr.decode(errors="replace").strip()
                raise AgentError(f"claude exited {proc.returncode}: {detail}")
            return stdout.decode(errors="replace").strip()
