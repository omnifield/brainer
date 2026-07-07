"""ClaudeCodeProvider — the single MVP provider.

launch = spawn `claude-scope.ps1 -Scope <scope> "<brief-as-initial-prompt>"` as a child in the
target repo's cwd, in its own console (Windows CREATE_NEW_CONSOLE) so the interactive session has
a terminal and we keep its PID. The brief travels as claude's initial prompt (headless message
injection is a later, self-hosted-provider era — out of MVP scope).

OTEL injection (brief §Session control): the brainer/writer launchers carry no OTEL block, so the
backend sets the collector env itself before spawning. That makes telemetry flow for any spawned
session regardless of the repo's launcher — status/activity then read out of Loki/Prometheus.

status/activity are composed from process liveness + the telemetry reader: for an external
process, activity is only observable via OTEL, not from the provider directly. A future
self-hosted provider would source these from its own agent-loop.
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

from ..config import Settings
from ..lib.trace import span
from ..sessions.models import Activity, SessionStatus
from ..telemetry.service import TelemetryService, derive_status
from .base import IAgentProvider, LaunchHandle

# Windows: give the session its own console; elsewhere: detach into a new session.
_NEW_CONSOLE = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)


class ClaudeCodeProvider(IAgentProvider):
    name = "claude-code"

    def __init__(self, settings: Settings, telemetry: TelemetryService):
        self._settings = settings
        self._telemetry = telemetry

    def _otel_env(self, scope: str, package: str, repo: str) -> dict[str, str]:
        return {
            "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
            "OTEL_METRICS_EXPORTER": "otlp",
            "OTEL_LOGS_EXPORTER": "otlp",
            "OTEL_EXPORTER_OTLP_PROTOCOL": "grpc",
            "OTEL_EXPORTER_OTLP_ENDPOINT": self._settings.otel_endpoint,
            "OTEL_RESOURCE_ATTRIBUTES": f"scope={scope},package={package},repo={repo}",
        }

    def _spawn(self, cmd: list[str], cwd: Path, env: dict[str, str]) -> subprocess.Popen:
        kwargs: dict = {"cwd": str(cwd), "env": env}
        if _NEW_CONSOLE:
            kwargs["creationflags"] = _NEW_CONSOLE
        elif sys.platform != "win32":
            kwargs["start_new_session"] = True
        return subprocess.Popen(cmd, **kwargs)

    def launch(self, *, repo_name: str, repo_path, scope: str, brief: Optional[str] = None) -> LaunchHandle:
        with span("provider.launch", scope=scope, repo=repo_name):
            repo_path = Path(repo_path)
            launcher = repo_path / "claude-scope.ps1"
            if not launcher.exists():
                raise FileNotFoundError(f"launcher not found: {launcher}")

            cmd = ["powershell", "-NoExit", "-ExecutionPolicy", "Bypass", "-File", str(launcher), "-Scope", scope]
            if brief:
                # Initial prompt → claude via the launcher's ClaudeArgs (ValueFromRemainingArguments).
                cmd.append(f"Прочитай бриф {brief} и приступай к работе.")

            env = os.environ.copy()
            env.update(self._otel_env(scope, package=scope, repo=repo_name))
            popen = self._spawn(cmd, repo_path, env)
            return LaunchHandle(scope=scope, package=scope, repo=repo_name, pid=popen.pid, popen=popen)

    def is_alive(self, handle: LaunchHandle) -> bool:
        if handle.popen is not None:
            return handle.popen.poll() is None
        return _pid_alive(handle.pid)

    async def status(self, handle: LaunchHandle) -> SessionStatus:
        activity = await self._telemetry.activity(handle.scope)
        return derive_status(
            alive=self.is_alive(handle),
            activity=activity,
            now=time.time(),
            threshold_s=self._settings.working_threshold_s,
        )

    async def activity(self, handle: LaunchHandle) -> Optional[Activity]:
        return await self._telemetry.activity(handle.scope)

    def stop(self, handle: LaunchHandle) -> bool:
        with span("provider.stop", pid=handle.pid):
            if sys.platform == "win32":
                # /T kills the child tree (powershell → claude), /F forces.
                subprocess.run(
                    ["taskkill", "/PID", str(handle.pid), "/T", "/F"],
                    capture_output=True,
                    check=False,
                )
            elif handle.popen is not None:
                handle.popen.terminate()
            return True


def _pid_alive(pid: int) -> bool:
    if sys.platform == "win32":
        out = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/NH"],
            capture_output=True,
            text=True,
            check=False,
        )
        return str(pid) in out.stdout
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False
