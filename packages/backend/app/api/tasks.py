"""Task routes = the contract's task board surface (thin).

  GET   /api/tasks        -> [Task]
  POST  /api/tasks        {sessionId?, title, status?} -> Task
  PATCH /api/tasks/:id     {title?, status?, sessionId?} -> Task
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..deps import Deps
from ..sessions.models import CreateTaskInput, Task, UpdateTaskInput
from .deps import get_deps

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("", response_model=list[Task])
async def list_tasks(deps: Deps = Depends(get_deps)) -> list[Task]:
    return deps.tasks.all()


@router.post("", response_model=Task)
async def create_task(input: CreateTaskInput, deps: Deps = Depends(get_deps)) -> Task:
    return deps.tasks.create(input)


@router.patch("/{task_id}", response_model=Task)
async def update_task(task_id: str, patch: UpdateTaskInput, deps: Deps = Depends(get_deps)) -> Task:
    task = deps.tasks.update(task_id, patch)
    if task is None:
        raise HTTPException(status_code=404, detail=f"task not found: {task_id}")
    return task
