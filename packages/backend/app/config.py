"""Settings + the managed-repo registry.

The registry answers one question: which repos may the backend spawn scoped sessions in, and at
what cwd. It is resolved with **no path-guessing** — neither parent-counting nor folder-name
hardcodes (both are stop-signals per canon; a clone into a differently-named dir must still work):

1. **env-first** — `BRAINER_REPOS` is an explicit, trusted list of `name=path` pairs, `;`-separated
   (e.g. `omnifield/brainer=/workspaces/brainer;omnifield/weber=/workspaces/weber`). When set it is
   the whole registry — no marker filter, explicit enumeration is trusted. The container launcher
   injects it (architect wires that after this fix), so no boot defaults are baked into code.
2. **discovery** (fallback when the env is unset) — walk *up* from this file to our own repo root
   (first dir carrying the `.claude/` harness marker), then scan its parent: every sibling dir that
   also carries `.claude/` is a managed repo, named by the `omnifield/<dirname>` convention. No
   parents[N], no name hardcodes — the marker is the fact "this dir lives under the agent harness".

`claude-scope.ps1` stays in each repo as the manual fallback + env reference, but it is legacy after
the container migration (new repos never carry it), so it is NOT the discovery marker — `.claude/` is.
The OTEL collector target is overridable via env (the adapter injects it so metrics flow).

TODO(architect): moving this map into devopser `registry/products.md` as the runtime source is a
future cross-zone decision; env + discovery is sufficient for now.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# The directory a repo carries once it lives under the agent harness — the discovery fact.
_HARNESS_MARKER = ".claude"


@dataclass(frozen=True)
class Repo:
    """A managed repository the backend can launch scoped sessions in."""

    name: str  # contract identity, e.g. "omnifield/brainer"
    path: Path  # cwd for the session

    @property
    def launcher(self) -> Path:
        # Legacy manual fallback / env reference; not used for discovery (see module docstring).
        return self.path / "claude-scope.ps1"


def _parse_repos_env(raw: str) -> dict[str, Repo]:
    """`name=path;name=path` → registry. Explicit = trusted: no marker filter. Malformed → raise
    (a silent-empty registry is the very bug this fix removes; surface the misconfig loudly)."""
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


def _own_root(start: Path) -> Path | None:
    """First directory at or above `start` that carries the harness marker."""
    for d in (start, *start.parents):
        if (d / _HARNESS_MARKER).is_dir():
            return d
    return None


def _scan_managed(parent: Path) -> dict[str, Repo]:
    """Every child of `parent` carrying the harness marker is a managed repo (name by convention)."""
    repos: dict[str, Repo] = {}
    try:
        children = sorted(parent.iterdir())
    except OSError:
        return repos
    for d in children:
        if d.is_dir() and (d / _HARNESS_MARKER).is_dir():
            name = f"omnifield/{d.name}"
            repos[name] = Repo(name=name, path=d)
    return repos


def _discover_repos() -> dict[str, Repo]:
    root = _own_root(Path(__file__).resolve())
    return _scan_managed(root.parent) if root is not None else {}


def _default_repos() -> dict[str, Repo]:
    raw = os.environ.get("BRAINER_REPOS")
    return _parse_repos_env(raw) if raw else _discover_repos()


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
