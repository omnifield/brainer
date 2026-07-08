"""Settings + the managed-repo registry.

Every managed repo (brainer / writer / …) ships its own `claude-scope.ps1` launcher — that
launcher IS the spawnability marker, so the registry is derived from it rather than from
hardcoded folder names or a `parents[N]` path count (both break on a checkout into any other
directory name). Resolution order:

1. ``BRAINER_REPOS`` env — an explicit ``name=path;name=path`` list, wins over discovery.
   Example: ``BRAINER_REPOS='omnifield/brainer=/srv/brainer;omnifield/writer=/srv/writer'``.
2. Discovery — walk up from this file to our own root (nearest ancestor carrying the launcher),
   then treat every sibling dir carrying a launcher as a managed repo.

Telemetry endpoints and the OTEL collector target are overridable via env so the same server
runs against a local or remote observability stack.

TODO(architect): a runtime repo map (devopser ``registry/products.md``) may later supersede
env+discovery as the source of truth — out of scope for this backend fix.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

_LAUNCHER = "claude-scope.ps1"


@dataclass(frozen=True)
class Repo:
    """A managed repository the backend can launch scoped sessions in."""

    name: str  # contract identity, e.g. "omnifield/brainer"
    path: Path  # cwd for the spawn

    @property
    def launcher(self) -> Path:
        return self.path / _LAUNCHER


def _find_own_root(start: Path) -> Path | None:
    """Nearest ancestor of ``start`` that carries a ``claude-scope.ps1`` launcher.

    Walking up to the marker keeps resolution independent of the checkout's folder name and of
    how deep this file sits — no ``parents[N]`` counting.
    """
    for parent in start.resolve().parents:
        if (parent / _LAUNCHER).exists():
            return parent
    return None


def _repos_from_env() -> dict[str, Repo] | None:
    """Parse ``BRAINER_REPOS='name=path;name=path'``; ``None`` when the var is unset/empty."""
    raw = os.environ.get("BRAINER_REPOS")
    if not raw or not raw.strip():
        return None
    repos: dict[str, Repo] = {}
    for entry in raw.split(";"):
        entry = entry.strip()
        if not entry:
            continue
        name, sep, path = entry.partition("=")
        name, path = name.strip(), path.strip()
        if not sep or not name or not path:
            raise ValueError(f"BRAINER_REPOS entry must be 'name=path', got: {entry!r}")
        repos[name] = Repo(name=name, path=Path(path))
    return repos


def _discover_repos(start: Path | None = None) -> dict[str, Repo]:
    """Sibling dirs (incl. our own root) carrying a launcher = managed repos.

    Contract identity is ``<parent-dir>/<repo-dir>`` — in the canonical layout the parent is
    ``omnifield``, so brainer resolves to ``omnifield/brainer`` with no folder name hardcoded.
    """
    own_root = _find_own_root(start or Path(__file__))
    if own_root is None:
        return {}
    parent = own_root.parent
    namespace = parent.name
    repos: dict[str, Repo] = {}
    for candidate in sorted(parent.iterdir()):
        if candidate.is_dir() and (candidate / _LAUNCHER).exists():
            name = f"{namespace}/{candidate.name}"
            repos[name] = Repo(name=name, path=candidate)
    return repos


def _default_repos() -> dict[str, Repo]:
    return _repos_from_env() or _discover_repos()


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
