"""Settings + the managed-repo registry.

Every managed repo (brainer / writer / …) ships its own `claude-scope.ps1` launcher — that file
stays as the manual fallback + env reference, but the backend no longer spawns it: sessions are
headless via the claude-code adapter (control-channel brief). The backend keeps the path→name list
here. The OTEL collector target is overridable via env (the adapter injects it so metrics flow).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# app/config.py -> …/omnifield/brainer/packages/backend/app -> parents[4] == …/omnifield.
_OMNIFIELD_ROOT = Path(__file__).resolve().parents[4]


@dataclass(frozen=True)
class Repo:
    """A managed repository the backend can launch scoped sessions in."""

    name: str  # contract identity, e.g. "omnifield/brainer"
    path: Path  # cwd for the session

    @property
    def launcher(self) -> Path:
        return self.path / "claude-scope.ps1"


def _default_repos() -> dict[str, Repo]:
    # Only repos that actually carry a claude-scope.ps1 launcher are spawnable (still the env reference).
    candidates = {
        "omnifield/brainer": _OMNIFIELD_ROOT / "brainer",
        "omnifield/writer": _OMNIFIELD_ROOT / "writer",
    }
    return {
        name: Repo(name=name, path=path)
        for name, path in candidates.items()
        if (path / "claude-scope.ps1").exists()
    }


@dataclass(frozen=True)
class Settings:
    # OTEL collector the adapter injects so token/cost metrics flow for any spawned session.
    otel_endpoint: str = field(default_factory=lambda: os.environ.get("BRAINER_OTEL_ENDPOINT", "http://localhost:4317"))
    # CLAUDE_CONFIG_DIR for the SDK: None → SDK default (existing CLI auth). Also the multi-account
    # isolation seam (§5) and half of the resume key (cwd + config_dir).
    claude_config_dir: str | None = field(default_factory=lambda: os.environ.get("BRAINER_CLAUDE_CONFIG_DIR") or None)
    # Per-session ring buffer cap for SSE Last-Event-ID replay (intra-process; delivery-only).
    channel_buffer_size: int = field(default_factory=lambda: int(os.environ.get("BRAINER_CHANNEL_BUFFER", "1024")))
    repos: dict[str, Repo] = field(default_factory=_default_repos)

    def repo(self, name: str) -> Repo | None:
        return self.repos.get(name)


def role_for_scope(scope: str) -> str:
    """architect on main, owner everywhere else (mirrors claude-scope / SCOPE_ROLE)."""
    return "architect" if scope == "main" else "owner"
