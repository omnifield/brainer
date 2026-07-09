"""App factory + ASGI entrypoint.

  uv run uvicorn app.main:app --reload

On start-up the hub resumes persisted sessions (blueprint В2); on shutdown it tears down live
clients and closes the registry. CORS is open for the dev dashboard. `create_app(deps=...)` accepts
injected deps for tests.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.sessions import router as sessions_router
from .api.tasks import router as tasks_router
from .config import Settings
from .deps import Deps, build_deps

logging.basicConfig(level=logging.INFO)


def create_app(deps: Deps | None = None) -> FastAPI:
    resolved = deps or build_deps(Settings())

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        await resolved.hub.resume_all()
        yield
        await resolved.hub.shutdown()
        resolved.store.close()

    app = FastAPI(title="Omnifield Brainer — backend", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.deps = resolved
    app.include_router(sessions_router)
    app.include_router(tasks_router)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
