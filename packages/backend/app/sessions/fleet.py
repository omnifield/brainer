"""FleetService — composes registry + provider liveness + telemetry into contract shapes.

The fleet = sessions WE spawned (registry, authoritative) merged with scopes discovered lit-up in
Loki (sessions started outside this backend). Registry entries win on scope collision.
"""

from __future__ import annotations

import time

from ..config import Settings, role_for_scope
from ..lib.trace import aspan
from ..providers.claude_code import ClaudeCodeProvider
from ..telemetry.service import TelemetryService, derive_status
from .models import (
    Activity,
    AssignBriefInput,
    CreateSessionInput,
    Session,
    SessionDetail,
    SessionStatus,
)
from .registry import LaunchedSession, SessionRegistry, now_iso
from .tasks import TaskStore

_DISCOVERED_MODEL = "unknown"


class FleetService:
    def __init__(
        self,
        settings: Settings,
        registry: SessionRegistry,
        provider: ClaudeCodeProvider,
        telemetry: TelemetryService,
        tasks: TaskStore,
    ):
        self._settings = settings
        self._registry = registry
        self._provider = provider
        self._telemetry = telemetry
        self._tasks = tasks

    # ---- reads ----

    async def list_sessions(self) -> list[Session]:
        async with aspan("fleet.list_sessions"):
            out: list[Session] = []
            seen_scopes: set[str] = set()
            for launched in self._registry.all():
                out.append(await self._session_of(launched))
                seen_scopes.add(launched.scope)

            for scope in await self._telemetry.discover_scopes():
                if scope in seen_scopes:
                    continue
                discovered = await self._discovered_session(scope)
                if discovered is not None:
                    out.append(discovered)
                    seen_scopes.add(scope)
            return out

    async def get_session(self, session_id: str) -> SessionDetail | None:
        async with aspan("fleet.get_session", id=session_id):
            launched = self._registry.get(session_id)
            if launched is not None:
                session = await self._session_of(launched)
                metrics = await self._telemetry.metrics(launched.scope)
                tasks = [t for t in self._tasks.all() if t.session_id == session_id]
                return SessionDetail(**session.model_dump(), brief=launched.brief, tasks=tasks, metrics=metrics)

            # Discovered session detail (id == "loki:<scope>").
            if session_id.startswith("loki:"):
                scope = session_id.split(":", 1)[1]
                session = await self._discovered_session(scope)
                if session is None:
                    return None
                metrics = await self._telemetry.metrics(scope)
                tasks = [t for t in self._tasks.all() if t.session_id == session_id]
                return SessionDetail(**session.model_dump(), brief=None, tasks=tasks, metrics=metrics)
            return None

    async def _session_of(self, launched: LaunchedSession) -> Session:
        activity = await self._provider.activity(launched.handle)
        status = derive_status(
            alive=self._provider.is_alive(launched.handle),
            activity=activity,
            now=time.time(),
            threshold_s=self._settings.working_threshold_s,
        )
        return Session(
            id=launched.id,
            repo=launched.repo,
            scope=launched.scope,
            role=role_for_scope(launched.scope),
            status=status,
            model=launched.model,
            started_at=launched.started_at,
            last_activity=activity or _spawned_activity(launched.started_at),
        )

    async def _discovered_session(self, scope: str) -> Session | None:
        activity = await self._telemetry.activity(scope)
        if activity is None:
            return None
        # Not our process — assume alive (it's emitting); freshness decides working vs idle.
        status: SessionStatus = derive_status(
            alive=True, activity=activity, now=time.time(), threshold_s=self._settings.working_threshold_s
        )
        model = await self._telemetry.model(scope) or _DISCOVERED_MODEL
        return Session(
            id=f"loki:{scope}",
            repo="unknown",  # repo not reliably carried on the Loki stream (MVP boundary)
            scope=scope,
            role=role_for_scope(scope),
            status=status,
            model=model,
            started_at=activity.at,  # true spawn time unknown; floor at earliest seen activity
            last_activity=activity,
        )

    # ---- writes ----

    async def launch(self, input: CreateSessionInput) -> str:
        repo = self._settings.repo(input.repo)
        if repo is None:
            raise ValueError(f"unknown repo: {input.repo}")
        handle = self._provider.launch(
            repo_name=repo.name, repo_path=repo.path, scope=input.scope, brief=input.brief_path
        )
        session_id = self._registry.new_id(input.scope)
        self._registry.add(
            LaunchedSession(
                id=session_id,
                repo=repo.name,
                scope=input.scope,
                role=role_for_scope(input.scope),
                model="claude-opus-4-8",  # owner sessions pin opus; refined via telemetry later
                handle=handle,
                started_at=now_iso(),
                brief=input.brief_path,
            )
        )
        return session_id

    def stop(self, session_id: str) -> bool:
        launched = self._registry.get(session_id)
        if launched is None:
            return False
        self._provider.stop(launched.handle)
        return True

    def scope_of(self, session_id: str) -> str | None:
        launched = self._registry.get(session_id)
        if launched is not None:
            return launched.scope
        if session_id.startswith("loki:"):
            return session_id.split(":", 1)[1]
        return None

    def assign_brief(self, session_id: str, input: AssignBriefInput) -> bool:
        launched = self._registry.get(session_id)
        if launched is None:
            return False
        # MVP: record the assignment (headless injection into a live session is out of scope).
        launched.brief = input.brief_path or input.brief_text
        return True


def _spawned_activity(at: str) -> Activity:
    return Activity(tool="status", at=at, summary="session spawned")
