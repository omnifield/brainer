"""App factory + ASGI entrypoint.

  uv run uvicorn app.main:app --host 0.0.0.0 --port 8010

The whole contract is served under the native `/brainer/` prefix (gateway parity: nginx proxies
`/api/brainer/` → `:8010/brainer/`, like svc_learn under `/learn/`). "Native" = `curl
:8010/brainer/sessions` works without the gateway too; we hold no root-level surface.

On start-up the hub resumes persisted sessions (blueprint В2); on shutdown it tears down live
clients and closes the registry. CORS is open for the dev dashboard. `create_app(deps=...)` accepts
injected deps for tests.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
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

    # Native `/brainer` prefix for the whole contract — one mount, existing route shapes preserved.
    brainer = APIRouter(prefix="/brainer")
    brainer.include_router(sessions_router)
    brainer.include_router(tasks_router)

    @brainer.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(brainer)

    return app


app = create_app()
