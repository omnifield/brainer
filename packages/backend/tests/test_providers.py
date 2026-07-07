"""ClaudeCodeProvider — launch/OTEL-injection/stop/status without spawning a real session."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

import pytest

from app.config import Settings
from app.providers import claude_code
from app.providers.base import LaunchHandle
from app.providers.claude_code import ClaudeCodeProvider
from app.sessions.models import Activity


class _FakeTelemetry:
    def __init__(self, activity: Optional[Activity] = None):
        self._activity = activity

    async def activity(self, scope: str, **_):
        return self._activity


class _FakePopen:
    def __init__(self, cmd, **kwargs):
        self.cmd = cmd
        self.kwargs = kwargs
        self.pid = 4242
        self._returncode = None

    def poll(self):
        return self._returncode


@pytest.fixture
def launcher_repo(tmp_path):
    (tmp_path / "claude-scope.ps1").write_text("# stub launcher")
    return tmp_path


def test_launch_injects_otel_and_passes_brief(monkeypatch, launcher_repo):
    captured = {}

    def fake_popen(cmd, **kwargs):
        p = _FakePopen(cmd, **kwargs)
        captured["cmd"] = cmd
        captured["env"] = kwargs["env"]
        return p

    monkeypatch.setattr(claude_code.subprocess, "Popen", fake_popen)
    provider = ClaudeCodeProvider(Settings(), _FakeTelemetry())

    handle = provider.launch(
        repo_name="omnifield/brainer", repo_path=launcher_repo, scope="backend", brief="briefs/backend-mvp.md"
    )

    assert handle.pid == 4242
    assert handle.scope == "backend"
    env = captured["env"]
    assert env["CLAUDE_CODE_ENABLE_TELEMETRY"] == "1"
    assert env["OTEL_EXPORTER_OTLP_PROTOCOL"] == "grpc"
    assert "scope=backend" in env["OTEL_RESOURCE_ATTRIBUTES"]
    assert "package=backend" in env["OTEL_RESOURCE_ATTRIBUTES"]
    assert "repo=omnifield/brainer" in env["OTEL_RESOURCE_ATTRIBUTES"]
    assert any("briefs/backend-mvp.md" in str(arg) for arg in captured["cmd"])
    assert "-Scope" in captured["cmd"] and "backend" in captured["cmd"]


def test_launch_missing_launcher_raises(tmp_path):
    provider = ClaudeCodeProvider(Settings(), _FakeTelemetry())
    with pytest.raises(FileNotFoundError):
        provider.launch(repo_name="x", repo_path=tmp_path, scope="backend")


def test_stop_issues_tree_kill(monkeypatch):
    calls = {}
    monkeypatch.setattr(claude_code.sys, "platform", "win32")
    monkeypatch.setattr(claude_code.subprocess, "run", lambda cmd, **kw: calls.setdefault("cmd", cmd))
    provider = ClaudeCodeProvider(Settings(), _FakeTelemetry())
    handle = LaunchHandle(scope="backend", package="backend", repo="r", pid=999)

    assert provider.stop(handle) is True
    assert calls["cmd"][:2] == ["taskkill", "/PID"]
    assert "999" in calls["cmd"] and "/T" in calls["cmd"]


async def test_status_working_when_alive_and_fresh():
    fresh = Activity(tool="Edit", at=datetime.now(tz=timezone.utc).isoformat(), summary="x")
    provider = ClaudeCodeProvider(Settings(), _FakeTelemetry(fresh))
    handle = LaunchHandle(scope="backend", package="backend", repo="r", pid=1, popen=_FakePopen([]))
    assert await provider.status(handle) == "working"


async def test_status_done_when_process_exited():
    provider = ClaudeCodeProvider(Settings(), _FakeTelemetry())
    popen = _FakePopen([])
    popen._returncode = 0  # exited
    handle = LaunchHandle(scope="backend", package="backend", repo="r", pid=1, popen=popen)
    assert await provider.status(handle) == "done"
