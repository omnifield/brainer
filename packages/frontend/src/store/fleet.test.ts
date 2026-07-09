import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { SessionSummary } from "../api/backend/contract";
import { MockApiClient } from "../api/mock/mockClient";
import { createFleetStore } from "./fleet";

// The session surface is real now, so the backend REST module is mocked with an in-memory fleet.
// Task-board still runs on the mock ApiClient. Both are exercised through the store's reactive root.
const backend = vi.hoisted(() => {
  let sessions: SessionSummary[] = [];
  const row = (id: string, scope: string, repo: string): SessionSummary => ({
    session_id: id,
    provider: "claude-code",
    role: scope,
    repo,
    status: "starting",
    sdk_session_id: null,
    created_at: "2026-07-09T00:00:00Z",
    updated_at: "2026-07-09T00:00:00Z",
  });
  return {
    seed: (s: SessionSummary[]) => {
      sessions = s;
    },
    listSessions: vi.fn(async () => sessions),
    launchSession: vi.fn(async (input: { repo: string; scope: string }) => {
      const id = `sess-${sessions.length}`;
      sessions = [...sessions, row(id, input.scope, input.repo)];
      return { id };
    }),
    stopSession: vi.fn(async (id: string) => {
      sessions = sessions.map((s) => (s.session_id === id ? { ...s, status: "stopped" } : s));
      return { ok: true };
    }),
    row,
  };
});

vi.mock("../api/backend/sessions", () => ({
  listSessions: backend.listSessions,
  launchSession: backend.launchSession,
  stopSession: backend.stopSession,
}));

const client = () => new MockApiClient({ tickMs: 0 });

function withStore(fn: (s: ReturnType<typeof createFleetStore>) => Promise<void>) {
  return createRoot(async (dispose) => {
    try {
      await fn(createFleetStore(client()));
    } finally {
      dispose();
    }
  });
}

describe("createFleetStore", () => {
  it("load populates sessions (real) + tasks (mock) and flips loaded", async () => {
    backend.seed([backend.row("sess-x", "kernel", "omnifield/brainer")]);
    await withStore(async ([state, actions]) => {
      expect(state.loaded).toBe(false);
      await actions.load();
      expect(state.loaded).toBe(true);
      expect(state.sessions.map((s) => s.session_id)).toContain("sess-x");
      expect(state.tasks.length).toBeGreaterThan(0);
    });
  });

  it("launch appends the new session to the store", async () => {
    backend.seed([]);
    await withStore(async ([state, actions]) => {
      await actions.load();
      const before = state.sessions.length;
      const id = await actions.launch({ repo: "omnifield/brainer", scope: "backend" });
      expect(state.sessions.length).toBe(before + 1);
      expect(state.sessions.some((s) => s.session_id === id)).toBe(true);
    });
  });

  it("stop flips the session status to stopped", async () => {
    backend.seed([backend.row("sess-live", "frontend", "omnifield/brainer")]);
    await withStore(async ([state, actions]) => {
      await actions.load();
      await actions.stop("sess-live");
      expect(state.sessions.find((s) => s.session_id === "sess-live")?.status).toBe("stopped");
    });
  });

  it("addTask and setTaskStatus write through the mock and update state", async () => {
    backend.seed([]);
    await withStore(async ([state, actions]) => {
      await actions.load();
      const before = state.tasks.length;
      await actions.addTask({ sessionId: null, title: "Store test task" });
      expect(state.tasks.length).toBe(before + 1);

      const target = state.tasks.find((t) => t.status === "todo");
      if (!target) throw new Error("expected a todo task in the mock seed");
      await actions.setTaskStatus(target.id, "done");
      expect(state.tasks.find((t) => t.id === target.id)?.status).toBe("done");
    });
  });
});
