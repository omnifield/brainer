"""Task-board models — the one interface-mvp surface that outlives the control-channel cut.

The session/telemetry half of interface-mvp is gone (replaced by the kernel event contract + SSE);
the task board is orthogonal to the control channel and stays as-is (camelCase on the wire, its own
`src/api/types.ts` shape). Changing a task field is still a cross-side contract change → architect.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

TaskStatus = Literal["todo", "in-progress", "blocked", "done"]


class CamelModel(BaseModel):
    # camelCase JSON on the wire, snake_case in Python; accept either on input.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Task(CamelModel):
    id: str
    session_id: str | None = None
    title: str
    status: TaskStatus


class CreateTaskInput(CamelModel):
    session_id: str | None = None
    title: str
    status: TaskStatus | None = None


class UpdateTaskInput(CamelModel):
    title: str | None = None
    status: TaskStatus | None = None
    session_id: str | None = None
