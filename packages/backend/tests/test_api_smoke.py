"""Control-channel route smoke tests — the API answers the shapes the frontend codes against.

No real SDK: a FakeAdapter backs the hub, and the store is a temp sqlite. Driven via an in-process
ASGI transport (single event loop → the sync kernel store stays on one thread). The point is the
route contract (paths, status codes, launch→list→send→stop), not live agent behaviour (that's e2e).
"""

from __future__ import annotations

import httpx
import pytest
from httpx import ASGITransport
from omnifield_kernel import AgentProvider, AgentSessionHandle, LaunchRequest, SessionStore

from app.config import Settings
from app.deps import build_deps
from app.main import create_app


class FakeAdapter(AgentProvider):
    name = "fake"

    async def launch(self, request: LaunchRequest) -> AgentSessionHandle:
        return AgentSessionHandle(
            session_id=f"{request.role}-test",
            provider="fake",
            provider_state={"sdk_session_id": "sdk-x", "seq_base": 0},
        )

    async def send(self, handle, text): ...

    async def stream(self, handle):
        if False:
            yield  # empty stream

    async def resume(self, handle):
        return handle

    async def stop(self, handle, force=False): ...

    def current_handle(self, handle):
        return handle


@pytest.fixture
async def client(tmp_path):
    store = SessionStore(tmp_path / "sessions.db")
    app = create_app(build_deps(Settings(), store=store, adapter=FakeAdapter()))
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    store.close()


async def test_health(client):
    assert (await client.get("/brainer/health")).json() == {"status": "ok"}


async def test_root_surface_is_gone(client):
    # Gateway parity: the whole contract lives under /brainer — we hold no root-level surface.
    assert (await client.get("/sessions")).status_code == 404
    assert (await client.get("/health")).status_code == 404
    assert (await client.get("/api/tasks")).status_code == 404


async def test_list_sessions_empty(client):
    r = await client.get("/brainer/sessions")
    assert r.status_code == 200
    assert r.json() == []


async def test_launch_then_listed(client):
    r = await client.post("/brainer/sessions", json={"repo": "omnifield/brainer", "scope": "backend"})
    assert r.status_code == 200
    sid = r.json()["id"]
    assert sid == "backend-test"

    sessions = (await client.get("/brainer/sessions")).json()
    assert len(sessions) == 1
    s = sessions[0]
    assert s["session_id"] == sid
    assert s["role"] == "backend"
    assert s["repo"] == "omnifield/brainer"
    assert s["provider"] == "fake"
    assert s["status"] in ("starting", "running", "waiting", "stopped")


async def test_launch_unknown_repo_is_400(client):
    r = await client.post("/brainer/sessions", json={"repo": "nope/nope", "scope": "backend"})
    assert r.status_code == 400


async def test_send_to_live_session(client):
    sid = (await client.post("/brainer/sessions", json={"repo": "omnifield/brainer", "scope": "backend"})).json()["id"]
    r = await client.post(f"/brainer/sessions/{sid}/messages", json={"text": "hi"})
    assert r.json() == {"ok": True}


async def test_send_to_unknown_session_is_404(client):
    assert (await client.post("/brainer/sessions/nope/messages", json={"text": "hi"})).status_code == 404


async def test_stop_unknown_session_is_404(client):
    assert (await client.post("/brainer/sessions/nope/stop")).status_code == 404


async def test_events_unknown_session_is_404(client):
    assert (await client.get("/brainer/sessions/nope/events")).status_code == 404


async def test_stop_known_session(client):
    sid = (await client.post("/brainer/sessions", json={"repo": "omnifield/brainer", "scope": "backend"})).json()["id"]
    r = await client.post(f"/brainer/sessions/{sid}/stop", json={"force": True})
    assert r.status_code == 200
    assert r.json() == {"ok": True}


async def test_task_crud_flow(client):
    resp = await client.post("/brainer/api/tasks", json={"sessionId": None, "title": "wire backend", "status": "todo"})
    created = resp.json()
    assert created["title"] == "wire backend"
    tid = created["id"]

    tasks = (await client.get("/brainer/api/tasks")).json()
    assert any(t["id"] == tid for t in tasks)

    patched = (await client.patch(f"/brainer/api/tasks/{tid}", json={"status": "done"})).json()
    assert patched["status"] == "done"

    assert (await client.patch("/brainer/api/tasks/nope", json={"status": "done"})).status_code == 404
