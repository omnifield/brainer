"""Settings + the managed-repo registry.

Every managed repo (brainer / writer / …) ships its own `claude-scope.ps1` launcher; the
backend keeps the path→name list here. Telemetry endpoints and the OTEL collector target
are overridable via env so the same server runs against a local or remote observability stack.
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
    path: Path  # cwd for the spawn

    @property
    def launcher(self) -> Path:
        return self.path / "claude-scope.ps1"


def _default_repos() -> dict[str, Repo]:
    # Only repos that actually carry a claude-scope.ps1 launcher are spawnable.
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
    loki_url: str = field(default_factory=lambda: os.environ.get("BRAINER_LOKI_URL", "http://localhost:3100"))
    prometheus_url: str = field(default_factory=lambda: os.environ.get("BRAINER_PROMETHEUS_URL", "http://localhost:9090"))
    otel_endpoint: str = field(default_factory=lambda: os.environ.get("BRAINER_OTEL_ENDPOINT", "http://localhost:4317"))
    # A session with telemetry newer than this is "working", else "idle".
    working_threshold_s: int = field(default_factory=lambda: int(os.environ.get("BRAINER_WORKING_THRESHOLD_S", "60")))
    # How far back to look when discovering sessions we did not spawn.
    discovery_lookback_s: int = field(
        default_factory=lambda: int(os.environ.get("BRAINER_DISCOVERY_LOOKBACK_S", "900"))
    )
    # SSE poll cadence for /stream.
    stream_poll_s: float = field(default_factory=lambda: float(os.environ.get("BRAINER_STREAM_POLL_S", "2.0")))
    repos: dict[str, Repo] = field(default_factory=_default_repos)

    def repo(self, name: str) -> Repo | None:
        return self.repos.get(name)


def role_for_scope(scope: str) -> str:
    """architect on main, owner everywhere else (mirrors claude-scope / SCOPE_ROLE)."""
    return "architect" if scope == "main" else "owner"
