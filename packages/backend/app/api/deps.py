"""FastAPI dependency accessors — pull the wired Deps off app.state."""

from __future__ import annotations

from fastapi import Request

from ..deps import Deps


def get_deps(request: Request) -> Deps:
    return request.app.state.deps
