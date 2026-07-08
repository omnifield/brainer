"""Session registry — persistent, provider-agnostic store of session handles (blueprint §1.3, deliverable 3).

sqlite in brainer's data-dir (not in a managed repo). Survives process restart so the backend can
resume live sessions on start-up. Stores the opaque `provider_state` verbatim — the registry never
interprets provider internals. One writer (backend); minimalism is fine per the answers-brief.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel

from .contract import AgentSessionHandle, LaunchRequest
from .paths import default_db_path
from .trace import span

_SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    session_id     TEXT PRIMARY KEY,
    provider       TEXT NOT NULL,
    provider_state TEXT NOT NULL,  -- opaque adapter JSON
    request        TEXT NOT NULL,  -- LaunchRequest JSON (role/repo/permission/...)
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
"""


class StoredSession(BaseModel):
    """A persisted session: its handle, the request it was launched with, and timestamps."""

    handle: AgentSessionHandle
    request: LaunchRequest
    created_at: str
    updated_at: str


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


class SessionStore:
    """CRUD over persisted session handles. Use as a context manager or call `close()`."""

    def __init__(self, db_path: Path | str | None = None) -> None:
        self.db_path = Path(db_path) if db_path is not None else default_db_path()
        with span("kernel.registry.init", db=self.db_path.name):
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(self.db_path))
            self._conn.row_factory = sqlite3.Row
            self._conn.executescript(_SCHEMA)
            self._conn.commit()

    def put(self, handle: AgentSessionHandle, request: LaunchRequest) -> StoredSession:
        """Insert or update a session by `session_id`; `created_at` is preserved across updates."""
        with span("kernel.registry.put", session_id=handle.session_id):
            now = _now_iso()
            existing = self.get(handle.session_id)
            created = existing.created_at if existing else now
            self._conn.execute(
                """
                INSERT INTO sessions (session_id, provider, provider_state, request, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    provider=excluded.provider,
                    provider_state=excluded.provider_state,
                    request=excluded.request,
                    updated_at=excluded.updated_at
                """,
                (
                    handle.session_id,
                    handle.provider,
                    json.dumps(handle.provider_state),
                    request.model_dump_json(),
                    created,
                    now,
                ),
            )
            self._conn.commit()
            return StoredSession(handle=handle, request=request, created_at=created, updated_at=now)

    def get(self, session_id: str) -> StoredSession | None:
        with span("kernel.registry.get", session_id=session_id):
            row = self._conn.execute("SELECT * FROM sessions WHERE session_id = ?", (session_id,)).fetchone()
            return _row_to_session(row) if row is not None else None

    def all(self) -> list[StoredSession]:
        """Every persisted session — the survivor list a backend replays for resume-on-start."""
        with span("kernel.registry.all"):
            rows = self._conn.execute("SELECT * FROM sessions ORDER BY created_at").fetchall()
            return [_row_to_session(row) for row in rows]

    def delete(self, session_id: str) -> bool:
        """Remove a session; returns True if a row was deleted."""
        with span("kernel.registry.delete", session_id=session_id):
            cur = self._conn.execute("DELETE FROM sessions WHERE session_id = ?", (session_id,))
            self._conn.commit()
            return cur.rowcount > 0

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> SessionStore:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def _row_to_session(row: sqlite3.Row) -> StoredSession:
    handle = AgentSessionHandle(
        session_id=row["session_id"],
        provider=row["provider"],
        provider_state=json.loads(row["provider_state"]),
    )
    request = LaunchRequest.model_validate_json(row["request"])
    return StoredSession(
        handle=handle,
        request=request,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )
