"""Real e2e — NOT collected by pytest (filename doesn't match test_*). Run manually:

    uv run python tests/e2e_control_channel.py

Exercises the DoD live against the real claude-agent-sdk + authed CLI (reply §5):
  launch headless → SSE events (status/message/done) → send follow-up in the SAME context →
  stop → resume in a fresh adapter (simulated restart) → context survived.

Safe: readonly→plan permission (no file writes), haiku model, pure Q&A prompts. Costs a few cents.
An env/auth blocker here is a STOP+escalate signal, never a reason to fake the e2e.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from omnifield_kernel import LaunchRequest  # noqa: E402

from app.adapters.claude_code import ClaudeCodeAdapter  # noqa: E402
from app.config import Settings  # noqa: E402

MODEL = "claude-haiku-4-5-20251001"
TOKEN = "HELLO-ALPHA-7"
TURN_TIMEOUT = 180


class Collector:
    def __init__(self) -> None:
        self.events: list = []
        self.done = asyncio.Event()

    async def run(self, adapter: ClaudeCodeAdapter, handle) -> None:
        async for event in adapter.stream(handle):
            self.events.append(event)
            kind = event.type
            if kind in ("message", "status", "tool-call", "done", "error", "limit"):
                detail = getattr(event.payload, "text", getattr(event.payload, "state", kind))
                print(f"  seq={event.seq:>4} {kind:<11} {str(detail)[:80]}")
            if kind == "done":
                self.done.set()

    async def wait_turn(self) -> None:
        await asyncio.wait_for(self.done.wait(), TURN_TIMEOUT)
        self.done.clear()

    def texts(self) -> str:
        return " ".join(e.payload.text for e in self.events if e.type == "message")


async def main() -> int:
    settings = Settings()
    adapter = ClaudeCodeAdapter(settings)
    req = LaunchRequest(role="main", repo="omnifield/brainer", permission="readonly", model=MODEL)

    print("== launch (headless) ==")
    handle = await adapter.launch(req)
    print(f"  session_id={handle.session_id}")

    col = Collector()
    task = asyncio.create_task(col.run(adapter, handle))

    print("== turn 1: send into live session ==")
    await adapter.send(handle, f"Reply with exactly this token and nothing else: {TOKEN}")
    await col.wait_turn()
    assert TOKEN in col.texts(), f"turn 1 did not echo token; got: {col.texts()[:200]}"
    types = {e.type for e in col.events}
    assert "status" in types and "message" in types and "done" in types, f"missing event types: {types}"
    # Ф2: the user's own reply must be in the wire stream (not just optimistic UI), before the answer.
    user_msgs = [e for e in col.events if e.type == "message" and e.payload.role == "user"]
    assert any(TOKEN in e.payload.text for e in user_msgs), "Ф2: user reply not injected into stream"
    agent_seq = next(e.seq for e in col.events if e.type == "message" and e.payload.role == "agent")
    assert user_msgs[0].seq < agent_seq, "Ф2: user reply not ordered before agent response"
    print("  OK: saw status + user-message + agent-message + done, ordering correct")

    refreshed = adapter.current_handle(handle)
    sdk_sid = refreshed.provider_state.get("sdk_session_id")
    assert sdk_sid, "no sdk_session_id captured — resume would be impossible"
    print(f"  captured sdk_session_id={sdk_sid}")

    print("== turn 2: follow-up in SAME context ==")
    before = len(col.events)
    await adapter.send(handle, "What token did I just ask you to reply with? Answer with only the token.")
    await col.wait_turn()
    turn2 = " ".join(e.payload.text for e in col.events[before:] if e.type == "message")
    assert TOKEN.split("-")[-1] in turn2 or TOKEN in turn2, f"context not retained; got: {turn2[:200]}"
    print("  OK: agent recalled the token from earlier in the session")

    print("== stop (hard) ==")
    await adapter.stop(handle, force=True)
    task.cancel()

    print("== resume in a FRESH adapter (simulated backend restart) ==")
    adapter2 = ClaudeCodeAdapter(settings)
    resumed = await adapter2.resume(refreshed)
    assert resumed.provider_state["seq_base"] > refreshed.provider_state.get("seq_base", 0), "seq_base did not advance"
    print(f"  resumed; seq_base {refreshed.provider_state.get('seq_base', 0)} -> {resumed.provider_state['seq_base']}")

    col2 = Collector()
    task2 = asyncio.create_task(col2.run(adapter2, resumed))
    await adapter2.send(resumed, "Repeat that same token one more time.")
    await col2.wait_turn()
    assert TOKEN.split("-")[-1] in col2.texts(), f"resumed session lost context; got: {col2.texts()[:200]}"
    print("  OK: resumed session recalled context across the restart")

    seqs = [e.seq for e in col2.events]
    assert all(s >= resumed.provider_state["seq_base"] for s in seqs), "resumed seq not monotonic past base"
    print(f"  OK: resumed seq monotonic past base ({min(seqs)}..{max(seqs)})")

    await adapter2.stop(resumed, force=True)
    task2.cancel()

    print("\nE2E PASSED  launch -> stream -> send -> context -> stop -> resume -> context-survived")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except AssertionError as exc:
        print(f"\nE2E FAILED  {exc}")
        raise SystemExit(1) from exc
