"""In-memory registry of sessions the backend spawned (MVP — no persistence).

Maps session id → its LaunchHandle + contract metadata (repo/scope/role/model/brief/startedAt).
This is the authoritative list of *our* sessions; the API merges it with Loki-discovered scopes
to form the full fleet. Extract target: this + providers/ + telemetry/ move to orchestrator once
the seam settles.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from ..providers.base import LaunchHandle


@dataclass
class LaunchedSession:
    id: str
    repo: str
    scope: str
    role: str
    model: str
    handle: LaunchHandle
    started_at: str
    brief: str | None = None


class SessionRegistry:
    def __init__(self) -> None:
        self._by_id: dict[str, LaunchedSession] = {}
        self._seq = 0

    def new_id(self, scope: str) -> str:
        self._seq += 1
        return f"s-{scope}-{self._seq}"

    def add(self, session: LaunchedSession) -> None:
        self._by_id[session.id] = session

    def get(self, session_id: str) -> LaunchedSession | None:
        return self._by_id.get(session_id)

    def all(self) -> list[LaunchedSession]:
        return list(self._by_id.values())

    def remove(self, session_id: str) -> None:
        self._by_id.pop(session_id, None)


def now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()
