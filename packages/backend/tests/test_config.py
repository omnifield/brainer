"""Registry resolution — env-first, then marker discovery — with **no path-guessing**.

The whole point of the fix: a checkout into a differently-named directory must still resolve, so
every test builds its own fake layout on tmp_path (fake `.claude/` markers) and never leans on the
machine's real checkout. See app/config.py module docstring.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import (
    Repo,
    Settings,
    _discover_repos,
    _own_root,
    _parse_repos_env,
    _scan_managed,
)


def _managed(dir_: Path) -> Path:
    """Make `dir_` look like a harnessed repo (carries the `.claude/` marker)."""
    dir_.mkdir(parents=True, exist_ok=True)
    (dir_ / ".claude").mkdir()
    return dir_


# ---- discovery (marker-based, layout-independent) ----


def test_own_root_walks_up_to_marker(tmp_path):
    root = _managed(tmp_path / "brainer-clone")  # ANY name — no folder-name hardcode
    deep = root / "packages" / "backend" / "app"
    deep.mkdir(parents=True)
    assert _own_root(deep / "config.py") == root


def test_own_root_none_without_marker(tmp_path):
    assert _own_root(tmp_path / "a" / "b" / "config.py") is None


def test_scan_managed_only_marked_dirs_named_by_convention(tmp_path):
    _managed(tmp_path / "brainer-clone")
    _managed(tmp_path / "weber")
    (tmp_path / "not-a-repo").mkdir()  # no marker → ignored
    (tmp_path / "loose-file").write_text("x")  # not a dir → ignored

    repos = _scan_managed(tmp_path)

    assert set(repos) == {"omnifield/brainer-clone", "omnifield/weber"}
    assert repos["omnifield/weber"].path == tmp_path / "weber"


def test_discover_is_independent_of_folder_name(tmp_path):
    # Full walk-up + sibling-scan against a fake tree; the repo dir is deliberately misnamed.
    root = _managed(tmp_path / "brainer-clone")
    _managed(tmp_path / "weber")
    start = root / "packages" / "backend" / "app" / "config.py"
    start.parent.mkdir(parents=True)

    found = _own_root(start)
    repos = _scan_managed(found.parent)

    assert "omnifield/brainer-clone" in repos
    assert "omnifield/weber" in repos


def test_scan_managed_missing_parent_is_empty(tmp_path):
    assert _scan_managed(tmp_path / "does-not-exist") == {}


# ---- env-first (explicit = trusted, overrides discovery, no marker filter) ----


def test_env_overrides_discovery(tmp_path, monkeypatch):
    a, b = tmp_path / "a", tmp_path / "b"  # NOTE: no `.claude/` markers — explicit is trusted
    monkeypatch.setenv("BRAINER_REPOS", f"omnifield/brainer={a};omnifield/weber={b}")

    repos = Settings().repos

    assert repos == {
        "omnifield/brainer": Repo(name="omnifield/brainer", path=a),
        "omnifield/weber": Repo(name="omnifield/weber", path=b),
    }


def test_parse_repos_env_tolerates_blank_and_whitespace():
    repos = _parse_repos_env(" omnifield/x = /p/x ; ; omnifield/y=/p/y ")
    assert repos["omnifield/x"].path == Path("/p/x")
    assert repos["omnifield/y"].path == Path("/p/y")


@pytest.mark.parametrize("bad", ["no-equals-sign", "=/only/path", "name-only="])
def test_parse_repos_env_rejects_malformed(bad):
    with pytest.raises(ValueError):
        _parse_repos_env(bad)


def test_no_env_falls_back_to_discovery(monkeypatch):
    monkeypatch.delenv("BRAINER_REPOS", raising=False)
    # Discovery runs against the real checkout; we only assert it's the discovery path, not a crash.
    assert Settings().repos == _discover_repos()
