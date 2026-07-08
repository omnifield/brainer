"""Contract-route smoke tests — the API answers the shapes the frontend codes against.

Telemetry is stubbed (MockTransport → empty), and launch is stubbed so no real session spawns;
the point is the route contract (shapes, camelCase aliases, status codes), not live data.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Repo, Settings
from app.deps import build_deps
from app.main import create_app
from app.providers.base import LaunchHandle


def _telemetry_handler(request: httpx.Request) -> httpx.Response:
    # Loki label-values -> [], everything else -> empty result set.
    if "/label/" in request.url.path:
        return httpx.Response(200, json={"status": "success", "data": []})
    return httpx.Response(200, json={"status": "success", "data": {"result": []}})


class _FakePopen:
    pid = 4242

    def poll(self):
        return None

    def terminate(self):
        # posix stop() path calls popen.terminate(); win32 path is patched per-test.
        return None


@pytest.fixture
def client(tmp_path):
    # Inject the registry so the contract tests don't depend on the machine's repo layout.
    (tmp_path / "claude-scope.ps1").write_text("# stub launcher")
    repos = {"omnifield/brainer": Repo(name="omnifield/brainer", path=tmp_path)}
    http = httpx.AsyncClient(transport=httpx.MockTransport(_telemetry_handler))
    deps = build_deps(Settings(repos=repos), http=http)
    # Stub the spawn so tests never launch a real powershell/claude process.
    deps.provider.launch = lambda **kw: LaunchHandle(  # type: ignore[method-assign]
        scope=kw["scope"], package=kw["scope"], repo=kw["repo_name"], pid=4242, popen=_FakePopen()
    )
    app = create_app(deps)
    with TestClient(app) as c:
        yield c


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_list_sessions_empty(client):
    r = client.get("/api/sessions")
    assert r.status_code == 200
    assert r.json() == []


def test_create_session_and_appears_in_fleet(client):
    r = client.post(
        "/api/sessions",
        json={"repo": "omnifield/brainer", "scope": "backend", "briefPath": "briefs/backend-mvp.md"},
    )
    assert r.status_code == 200
    session_id = r.json()["id"]
    assert session_id

    sessions = client.get("/api/sessions").json()
    assert len(sessions) == 1
    s = sessions[0]
    # camelCase contract fields present.
    assert s["scope"] == "backend"
    assert s["role"] == "owner"
    assert "startedAt" in s and "lastActivity" in s
    assert s["lastActivity"]["tool"] == "status"


def test_create_session_unknown_repo_is_400(client):
    r = client.post("/api/sessions", json={"repo": "nope/nope", "scope": "backend"})
    assert r.status_code == 400


def test_get_unknown_session_is_404(client):
    assert client.get("/api/sessions/does-not-exist").status_code == 404


def test_stop_unknown_session_is_404(client):
    assert client.post("/api/sessions/does-not-exist/stop").status_code == 404


def test_stream_unknown_session_is_404(client):
    assert client.get("/api/sessions/does-not-exist/stream").status_code == 404


def test_session_detail_includes_brief_tasks_metrics(client):
    session_id = client.post("/api/sessions", json={"repo": "omnifield/brainer", "scope": "backend"}).json()["id"]
    detail = client.get(f"/api/sessions/{session_id}").json()
    assert "brief" in detail
    assert detail["tasks"] == []
    assert "metrics" in detail  # additive Prometheus rollup


def test_task_crud_flow(client):
    created = client.post("/api/tasks", json={"sessionId": None, "title": "wire backend", "status": "todo"}).json()
    assert created["title"] == "wire backend"
    tid = created["id"]

    tasks = client.get("/api/tasks").json()
    assert any(t["id"] == tid for t in tasks)

    patched = client.patch(f"/api/tasks/{tid}", json={"status": "done"}).json()
    assert patched["status"] == "done"

    assert client.patch("/api/tasks/nope", json={"status": "done"}).status_code == 404


def test_stop_known_session(client):
    import app.providers.claude_code as cc

    # stop() shells out to taskkill on win32; make it a no-op for the test.
    session_id = client.post("/api/sessions", json={"repo": "omnifield/brainer", "scope": "backend"}).json()["id"]
    orig = cc.subprocess.run
    cc.subprocess.run = lambda *a, **k: None
    try:
        r = client.post(f"/api/sessions/{session_id}/stop")
    finally:
        cc.subprocess.run = orig
    assert r.status_code == 200
    assert r.json() == {"ok": True}
