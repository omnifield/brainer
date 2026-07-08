import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onSpan, type TraceSpan } from "../../lib/trace";
import { MockApiClient } from "./mockClient";

// Deterministic clock + RNG so the contract adapter is fully testable.
const FIXED_NOW = Date.UTC(2026, 6, 7, 12, 0, 0);
const make = (rand = () => 0.5) => new MockApiClient({ tickMs: 0, now: () => FIXED_NOW, rand });

describe("MockApiClient — contract shape", () => {
  it("listSessions returns the seeded fleet with contract fields", async () => {
    const sessions = await make().listSessions();
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) {
      expect(s).toMatchObject({
        id: expect.any(String),
        repo: expect.any(String),
        scope: expect.any(String),
        role: expect.stringMatching(/architect|owner/),
        status: expect.stringMatching(/idle|working|blocked|done|error/),
        model: expect.any(String),
        startedAt: expect.any(String),
      });
      expect(s.lastActivity).toMatchObject({
        tool: expect.any(String),
        at: expect.any(String),
        summary: expect.any(String),
      });
    }
  });

  it("returns cloned data — mutating a result never leaks into the store", async () => {
    const client = make();
    const first = await client.listSessions();
    first[0]!.status = "error";
    const second = await client.listSessions();
    expect(second[0]!.status).not.toBe("error");
  });
});

describe("MockApiClient — sessions lifecycle", () => {
  it("createSession prepends a working session and returns its id", async () => {
    const client = make();
    const before = (await client.listSessions()).length;
    const { id } = await client.createSession({ repo: "omnifield/x", scope: "backend" });
    const after = await client.listSessions();
    expect(after.length).toBe(before + 1);
    expect(after[0]!.id).toBe(id);
    expect(after[0]!.status).toBe("working");
    expect(after[0]!.role).toBe("owner");
  });

  it("createSession with scope=main yields an architect role", async () => {
    const client = make();
    const { id } = await client.createSession({ repo: "omnifield/x", scope: "main" });
    const detail = await client.getSession(id);
    expect(detail.role).toBe("architect");
  });

  it("getSession merges brief + owned tasks", async () => {
    const detail = await make().getSession("s-fe");
    expect(detail.brief).toBe("briefs/interface-mvp.md");
    expect(detail.tasks.every((t) => t.sessionId === "s-fe")).toBe(true);
    expect(detail.tasks.length).toBeGreaterThan(0);
  });

  it("getSession rejects an unknown id", async () => {
    await expect(make().getSession("nope")).rejects.toThrow(/not found/);
  });

  it("stopSession flips status to done", async () => {
    const client = make();
    const res = await client.stopSession("s-fe");
    expect(res.ok).toBe(true);
    const detail = await client.getSession("s-fe");
    expect(detail.status).toBe("done");
  });

  it("assignBrief updates the brief seen by getSession", async () => {
    const client = make();
    await client.assignBrief("s-kernel", { briefPath: "briefs/kernel-seam.md" });
    const detail = await client.getSession("s-kernel");
    expect(detail.brief).toBe("briefs/kernel-seam.md");
  });
});

describe("MockApiClient — tasks", () => {
  it("createTask appends with defaulted todo status", async () => {
    const client = make();
    const task = await client.createTask({ sessionId: null, title: "New" });
    expect(task.status).toBe("todo");
    const all = await client.listTasks();
    expect(all.map((t) => t.id)).toContain(task.id);
  });

  it("updateTask patches status", async () => {
    const client = make();
    const updated = await client.updateTask("t-3", { status: "done" });
    expect(updated.status).toBe("done");
    const all = await client.listTasks();
    expect(all.find((t) => t.id === "t-3")!.status).toBe("done");
  });

  it("updateTask rejects unknown id", async () => {
    await expect(make().updateTask("t-nope", { status: "done" })).rejects.toThrow(/not found/);
  });
});

describe("MockApiClient — activity simulation", () => {
  it("simulateEvent mutates lastActivity and returns a contract event", () => {
    const client = make(() => 0.5);
    const event = client.simulateEvent("s-fe");
    expect(event).not.toBeNull();
    expect(event!.sessionId).toBe("s-fe");
    expect(event!.tool).toBeTypeOf("string");
    expect(event!.summary).toBeTypeOf("string");
  });

  it("does not emit for terminal (done/error) sessions", () => {
    const client = make();
    // s-content is seeded 'done', s-orch is 'error'
    expect(client.simulateEvent("s-content")).toBeNull();
    expect(client.simulateEvent("s-orch")).toBeNull();
  });

  it("streamSession returns a no-op unsub for terminal sessions", () => {
    const client = make(() => 0.5);
    const spy = vi.fn();
    const unsub = client.streamSession("s-content", spy);
    unsub();
    expect(spy).not.toHaveBeenCalled();
  });

  it("streamSession pushes events on tick for live sessions", () => {
    vi.useFakeTimers();
    const client = new MockApiClient({ tickMs: 100, now: () => FIXED_NOW, rand: () => 0.5 });
    const events: unknown[] = [];
    const unsub = client.streamSession("s-fe", (e) => events.push(e));
    vi.advanceTimersByTime(350);
    unsub();
    expect(events.length).toBe(3);
    vi.useRealTimers();
  });
});

describe("MockApiClient — trace instrumentation", () => {
  let spans: TraceSpan[];
  let off: () => void;
  beforeEach(() => {
    spans = [];
    off = onSpan((s) => spans.push(s));
  });
  afterEach(() => off());

  it("emits a span for each contract call", async () => {
    await make().listSessions();
    expect(spans.some((s) => s.name === "mock.listSessions" && s.ok)).toBe(true);
  });
});
