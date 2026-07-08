"""Boundary guard (brief §Граница): the kernel imports no sibling package and no vendor SDK.

Enforces "ноль знаний о Claude, ноль deps на вендорские SDK" statically, so a regression is caught
in CI rather than at extract time (kernel → engines repo must be a `git mv`, not a rewrite).
"""

from __future__ import annotations

import ast
import tomllib
from pathlib import Path

_PKG_DIR = Path(__file__).resolve().parents[1] / "src" / "omnifield_kernel"
_PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"

# Sibling packages the kernel must never import (self-sufficiency; extract = git mv).
_FORBIDDEN_SIBLINGS = {"app", "backend", "frontend", "orchestrator"}
# Vendor SDKs / provider specifics that must live in the adapter, not the kernel.
_FORBIDDEN_VENDOR = {"anthropic", "claude_agent_sdk", "claude"}
_FORBIDDEN = _FORBIDDEN_SIBLINGS | _FORBIDDEN_VENDOR


def _imported_roots(source: str) -> set[str]:
    roots: set[str] = set()
    tree = ast.parse(source)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:  # absolute imports only; relative are intra-package
                roots.add(node.module.split(".")[0])
    return roots


def test_no_forbidden_imports_in_source():
    offenders: dict[str, set[str]] = {}
    for path in _PKG_DIR.rglob("*.py"):
        bad = _imported_roots(path.read_text(encoding="utf-8")) & _FORBIDDEN
        if bad:
            offenders[str(path.relative_to(_PKG_DIR))] = bad
    assert not offenders, f"kernel must not import siblings/vendor SDKs: {offenders}"


def test_no_vendor_dependencies_declared():
    data = tomllib.loads(_PYPROJECT.read_text(encoding="utf-8"))
    deps = data["project"]["dependencies"]
    lowered = " ".join(deps).lower()
    for vendor in ("anthropic", "claude"):
        assert vendor not in lowered, f"kernel pyproject declares a vendor dep: {deps}"
