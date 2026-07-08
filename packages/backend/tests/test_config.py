"""Repo registry — env override + marker-based discovery, both independent of machine layout."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Repo, Settings, _discover_repos, _repos_from_env


def _make_repo(parent: Path, name: str) -> Path:
    d = parent / name
    (d / "app").mkdir(parents=True)
    (d / "claude-scope.ps1").write_text("# stub launcher")
    return d


def test_discover_finds_repos_by_marker_regardless_of_name(tmp_path):
    eco = tmp_path / "omnifield"
    brainer = _make_repo(eco, "brainer-clone")  # deliberately not named "brainer"
    writer = _make_repo(eco, "writer")
    (eco / "not-a-repo").mkdir()  # no launcher → ignored

    # Discovery starts from a (non-existent-on-disk) file deep inside the clone, like __file__.
    repos = _discover_repos(start=brainer / "app" / "config.py")

    assert set(repos) == {"omnifield/brainer-clone", "omnifield/writer"}
    assert repos["omnifield/brainer-clone"].path == brainer
    assert repos["omnifield/writer"].path == writer


def test_discover_empty_when_no_launcher_above(tmp_path):
    assert _discover_repos(start=tmp_path / "app" / "config.py") == {}


def test_env_repos_override_wins_over_discovery(tmp_path, monkeypatch):
    p1, p2 = tmp_path / "b", tmp_path / "w"
    p1.mkdir()
    p2.mkdir()
    monkeypatch.setenv("BRAINER_REPOS", f"omnifield/brainer={p1} ; omnifield/writer={p2}")

    settings = Settings()

    assert set(settings.repos) == {"omnifield/brainer", "omnifield/writer"}
    assert settings.repo("omnifield/brainer").path == p1
    assert settings.repo("omnifield/writer").path == p2


def test_env_repos_unset_returns_none(monkeypatch):
    monkeypatch.delenv("BRAINER_REPOS", raising=False)
    assert _repos_from_env() is None


def test_env_repos_malformed_entry_raises(monkeypatch):
    monkeypatch.setenv("BRAINER_REPOS", "no-equals-sign")
    with pytest.raises(ValueError):
        _repos_from_env()


def test_repo_launcher_path():
    base = Path("/srv/brainer")
    repo = Repo(name="omnifield/brainer", path=base)
    assert repo.launcher == base / "claude-scope.ps1"
