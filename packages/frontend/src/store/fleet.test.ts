import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { MockApiClient } from "../api/mock/mockClient";
import type { ActivityEvent } from "../api/types";
import { createFleetStore } from "./fleet";

const FIXED_NOW = Date.UTC(2026, 6, 7, 12, 0, 0);
const client = () => new MockApiClient({ tickMs: 0, now: () => FIXED_NOW, rand: () => 0.5 });

// Store owns the small orchestration logic; screens stay dumb. Tested inside a
// reactive root so createStore behaves as it does in the app.

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
  it("load populates sessions + tasks and flips loaded", async () => {
    await withStore(async ([state, actions]) => {
      expect(state.loaded).toBe(false);
      await actions.load();
      expect(state.loaded).toBe(true);
      expect(state.sessions.length).toBeGreaterThan(0);
      expect(state.tasks.length).toBeGreaterThan(0);
    });
  });

  it("spawn appends a session to the store", async () => {
    await withStore(async ([state, actions]) => {
      await actions.load();
      const before = state.sessions.length;
      const id = await actions.spawn({ repo: "omnifield/x", scope: "backend" });
      expect(state.sessions.length).toBe(before + 1);
      expect(state.sessions.some((s) => s.id === id)).toBe(true);
    });
  });

  it("stop sets the session status to done", async () => {
    await withStore(async ([state, actions]) => {
      await actions.load();
      await actions.stop("s-fe");
      expect(state.sessions.find((s) => s.id === "s-fe")!.status).toBe("done");
    });
  });

  it("addTask and setTaskStatus write through and update state", async () => {
    await withStore(async ([state, actions]) => {
      await actions.load();
      const before = state.tasks.length;
      await actions.addTask({ sessionId: null, title: "Store test task" });
      expect(state.tasks.length).toBe(before + 1);

      const target = state.tasks.find((t) => t.status === "todo")!;
      await actions.setTaskStatus(target.id, "done");
      expect(state.tasks.find((t) => t.id === target.id)!.status).toBe("done");
    });
  });

  it("applyEvent folds a streamed event into the matching session", async () => {
    await withStore(async ([state, actions]) => {
      await actions.load();
      const event: ActivityEvent = {
        sessionId: "s-fe",
        kind: "tool",
        tool: "Bash",
        summary: "npm run build",
        at: new Date(FIXED_NOW).toISOString(),
        status: "blocked",
      };
      actions.applyEvent(event);
      const s = state.sessions.find((x) => x.id === "s-fe")!;
      expect(s.lastActivity.summary).toBe("npm run build");
      expect(s.status).toBe("blocked");
    });
  });
});
