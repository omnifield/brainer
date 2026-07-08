"""Session registry: CRUD, opaque provider_state, and survival across a process restart."""

from __future__ import annotations

import subprocess
import sys
import textwrap

from omnifield_kernel import AgentSessionHandle, LaunchRequest, SessionStore


def _handle(sid: str = "s-1", state: dict | None = None) -> AgentSessionHandle:
    return AgentSessionHandle(
        session_id=sid,
        provider="claude-code",
        provider_state=state or {"sdk_session_id": "abc", "cwd": "/repo", "config_dir": "/cfg"},
    )


def _request(role: str = "owner") -> LaunchRequest:
    return LaunchRequest(role=role, repo="omnifield/brainer", permission="standard", model="sonnet")


def test_put_get_roundtrip(tmp_path):
    with SessionStore(tmp_path / "s.db") as store:
        stored = store.put(_handle(), _request())
        got = store.get("s-1")
    assert got is not None
    assert got.handle == _handle()
    assert got.request == _request()
    assert got.created_at == stored.created_at


def test_all_and_delete(tmp_path):
    with SessionStore(tmp_path / "s.db") as store:
        store.put(_handle("s-1"), _request())
        store.put(_handle("s-2"), _request("main"))
        assert {s.handle.session_id for s in store.all()} == {"s-1", "s-2"}
        assert store.delete("s-1") is True
        assert store.delete("s-1") is False  # already gone
        assert {s.handle.session_id for s in store.all()} == {"s-2"}


def test_update_preserves_created_at(tmp_path):
    with SessionStore(tmp_path / "s.db") as store:
        first = store.put(_handle(state={"turns": 0}), _request())
        # resume() hands back a handle with refreshed opaque state; re-put upserts it.
        second = store.put(_handle(state={"turns": 1, "resumed": True}), _request())
    assert second.created_at == first.created_at
    assert second.updated_at >= first.updated_at
    assert second.handle.provider_state == {"turns": 1, "resumed": True}


def test_provider_state_is_opaque(tmp_path):
    # The registry stores arbitrary adapter JSON verbatim without interpreting it.
    weird = {"nested": {"a": [1, 2, 3]}, "flag": True, "n": None}
    with SessionStore(tmp_path / "s.db") as store:
        store.put(_handle(state=weird), _request())
        assert store.get("s-1").handle.provider_state == weird


def test_survives_process_restart(tmp_path):
    # DoD: "записал handle → новый процесс читает". A fresh SessionStore on the same file is a new
    # connection reading persisted bytes — the durability guarantee sqlite provides across restarts.
    db = tmp_path / "s.db"
    with SessionStore(db) as writer:
        writer.put(_handle(), _request())
    with SessionStore(db) as reader:
        survivor = reader.get("s-1")
    assert survivor is not None
    assert survivor.handle == _handle()
    assert survivor.request.role == "owner"


def test_read_from_a_separate_os_process(tmp_path):
    # The literal DoD: a genuinely new process (not just a new connection) reads the handle back.
    db = tmp_path / "s.db"
    with SessionStore(db) as writer:
        writer.put(_handle("s-proc"), _request())

    reader_script = textwrap.dedent(
        """
        import sys
        from omnifield_kernel import SessionStore
        with SessionStore(sys.argv[1]) as store:
            got = store.get("s-proc")
        assert got is not None and got.handle.provider == "claude-code", "handle did not survive"
        print(got.handle.provider_state["sdk_session_id"])
        """
    )
    out = subprocess.run(
        [sys.executable, "-c", reader_script, str(db)],
        capture_output=True, text=True, check=True,
    )
    assert out.stdout.strip() == "abc"
