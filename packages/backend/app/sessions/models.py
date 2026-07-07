"""Contract models — the exact shapes fixed by briefs/interface-mvp.md §Контракт.

Source of truth is the frontend's `src/api/types.ts`; these Pydantic models must serialize to
the identical JSON (camelCase: `startedAt`, `lastActivity`, `sessionId`). Changing an existing
field is a cross-side contract change → STOP + architect. `SessionDetail.metrics` is an ADDITIVE
optional field (Prometheus metrics, per the backend brief) — non-breaking, pending ratification.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

SessionStatus = Literal["idle", "working", "blocked", "done", "error"]
Role = Literal["architect", "owner"]
TaskStatus = Literal["todo", "in-progress", "blocked", "done"]


class CamelModel(BaseModel):
    # camelCase JSON on the wire, snake_case in Python; accept either on input.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Activity(CamelModel):
    tool: str
    at: str  # ISO timestamp
    summary: str


class Session(CamelModel):
    id: str
    repo: str
    scope: str
    role: Role
    status: SessionStatus
    model: str
    started_at: str
    last_activity: Activity


class Task(CamelModel):
    id: str
    session_id: Optional[str] = None
    title: str
    status: TaskStatus


class Metrics(CamelModel):
    """Additive per-session Prometheus rollup (see module docstring)."""

    tokens: float = 0.0
    cost_usd: float = 0.0
    active_time_s: float = 0.0
    session_count: float = 0.0


class SessionDetail(Session):
    brief: Optional[str] = None
    tasks: list[Task] = []
    metrics: Optional[Metrics] = None


class ActivityEvent(CamelModel):
    session_id: str
    kind: Literal["tool", "prompt", "status"]
    tool: str
    summary: str
    at: str
    status: Optional[SessionStatus] = None


# ---- request payloads ----


class CreateSessionInput(CamelModel):
    repo: str
    scope: str
    brief_path: Optional[str] = None


class AssignBriefInput(CamelModel):
    brief_path: Optional[str] = None
    brief_text: Optional[str] = None


class CreateTaskInput(CamelModel):
    session_id: Optional[str] = None
    title: str
    status: Optional[TaskStatus] = None


class UpdateTaskInput(CamelModel):
    title: Optional[str] = None
    status: Optional[TaskStatus] = None
    session_id: Optional[str] = None
