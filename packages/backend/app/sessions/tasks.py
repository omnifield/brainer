"""In-memory task store (MVP). The task board reads/writes these; no session coupling beyond
the optional sessionId link the contract defines.
"""

from __future__ import annotations

from .models import CreateTaskInput, Task, UpdateTaskInput


class TaskStore:
    def __init__(self) -> None:
        self._tasks: list[Task] = []
        self._seq = 0

    def all(self) -> list[Task]:
        return list(self._tasks)

    def create(self, input: CreateTaskInput) -> Task:
        self._seq += 1
        task = Task(
            id=f"t-{self._seq}",
            session_id=input.session_id,
            title=input.title,
            status=input.status or "todo",
        )
        self._tasks.append(task)
        return task

    def update(self, task_id: str, patch: UpdateTaskInput) -> Task | None:
        for task in self._tasks:
            if task.id == task_id:
                data = patch.model_dump(exclude_unset=True)
                for key, value in data.items():
                    setattr(task, key, value)
                return task
        return None
