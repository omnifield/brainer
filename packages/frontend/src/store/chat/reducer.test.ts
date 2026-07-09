import { describe, expect, it } from "vitest";
import type * as wire from "../../api/generated/events";
import {
  type ChatState,
  initialChatState,
  reduceEvent,
  reduceEvents,
  reduceLocalUserMessage,
} from "./reducer";

// Minimal event builders — the wire envelope with a per-type payload. `type` is optional in the
// generated shape (schema default), but the wire always carries it, so we set it here too.
let seqCounter = 0;
function ev<T extends wire.AgentSessionEvent>(
  partial: Omit<T, "session_id" | "seq" | "ts">,
  seq?: number,
): T {
  seqCounter += 1;
  return { session_id: "s1", seq: seq ?? seqCounter, ts: "2026-07-09T00:00:00Z", ...partial } as T;
}

const message = (text: string, role: "agent" | "user" = "agent", seq?: number) =>
  ev<wire.MessageEvent>({ type: "message", payload: { role, text } }, seq);
const thinking = (text: string, seq?: number) =>
  ev<wire.ThinkingEvent>({ type: "thinking", payload: { text } }, seq);
const toolCall = (callId: string, tool: string, seq?: number) =>
  ev<wire.ToolCallEvent>({ type: "tool-call", payload: { call_id: callId, tool, input: {} } }, seq);
const toolResult = (
  callId: string,
  output: wire.ToolResultPayload["output"],
  isError = false,
  seq?: number,
) =>
  ev<wire.ToolResultEvent>(
    { type: "tool-result", payload: { call_id: callId, output, is_error: isError } },
    seq,
  );
const status = (state: wire.StatusPayload["state"], seq?: number) =>
  ev<wire.StatusEvent>({ type: "status", payload: { state } }, seq);
const done = (reason: wire.DonePayload["reason"], seq?: number) =>
  ev<wire.DoneEvent>(
    { type: "done", payload: { reason, usage: { input_tokens: 1, output_tokens: 2 } } },
    seq,
  );
const error = (seq?: number) =>
  ev<wire.ErrorEvent>(
    { type: "error", payload: { code: "x", message: "boom", retryable: false } },
    seq,
  );
const limit = (seq?: number) =>
  ev<wire.LimitEvent>({ type: "limit", payload: { scope: "rate" } }, seq);
const permission = (seq?: number) =>
  ev<wire.PermissionRequestEvent>(
    { type: "permission-request", payload: { request_id: "r1", tool: "Bash", input: {} } },
    seq,
  );

describe("reduceEvent — all nine event types render a row", () => {
  it("message / thinking / status / done / error / limit / permission each append one item", () => {
    const events = [
      message("hi"),
      thinking("hmm"),
      status("running"),
      done("completed"),
      error(),
      limit(),
      permission(),
    ];
    const state = reduceEvents(initialChatState(), events);
    expect(state.items.map((i) => i.kind)).toEqual([
      "message",
      "thinking",
      "status",
      "done",
      "error",
      "limit",
      "permission",
    ]);
  });

  it("tool-call + tool-result collapse into ONE tool row paired by call_id", () => {
    const state = reduceEvents(initialChatState(), [
      toolCall("c1", "Bash"),
      toolResult("c1", { text: "ok" }),
    ]);
    expect(state.items).toHaveLength(1);
    const row = state.items[0];
    expect(row.kind).toBe("tool");
    if (row.kind === "tool") {
      expect(row.call?.payload.tool).toBe("Bash");
      expect(row.result?.payload.output).toEqual({ text: "ok" });
    }
  });

  it("interleaved tool calls pair to the right row by call_id", () => {
    const state = reduceEvents(initialChatState(), [
      toolCall("c1", "Read"),
      toolCall("c2", "Bash"),
      toolResult("c2", { out: "b-out" }),
      toolResult("c1", { out: "a-out" }),
    ]);
    expect(state.items).toHaveLength(2);
    const [first, second] = state.items;
    if (first.kind === "tool") expect(first.result?.payload.output).toEqual({ out: "a-out" });
    if (second.kind === "tool") expect(second.result?.payload.output).toEqual({ out: "b-out" });
  });

  it("an orphan tool-result (no matching call) starts its own row rather than being dropped", () => {
    const state = reduceEvent(initialChatState(), toolResult("ghost", { x: 1 }));
    expect(state.items).toHaveLength(1);
    const row = state.items[0];
    expect(row.kind).toBe("tool");
    if (row.kind === "tool") {
      expect(row.call).toBeNull();
      expect(row.result?.payload.call_id).toBe("ghost");
    }
  });
});

describe("reduceEvent — seq dedup / reconnect splice", () => {
  it("drops events whose seq was already folded (reconnect replay is idempotent)", () => {
    const first = reduceEvents(initialChatState(), [
      message("a", "agent", 1),
      message("b", "agent", 2),
    ]);
    // Reconnect replays 1..3; 1 and 2 are dupes, only 3 is new.
    const after = reduceEvents(first, [
      message("a", "agent", 1),
      message("b", "agent", 2),
      message("c", "agent", 3),
    ]);
    expect(after.items.map((i) => (i.kind === "message" ? i.event.payload.text : ""))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(after.lastSeq).toBe(3);
  });

  it("ignores an out-of-order lower seq without corrupting the cursor", () => {
    const state = reduceEvents(initialChatState(), [
      message("hi", "agent", 5),
      message("stale", "agent", 3),
    ]);
    expect(state.items).toHaveLength(1);
    expect(state.lastSeq).toBe(5);
  });

  it("stays monotone across a resume epoch jump (seq leaps by a block)", () => {
    const state = reduceEvents(initialChatState(), [
      message("pre", "agent", 2),
      status("stopped", 3),
      // resume: new epoch, seq jumps far ahead but stays > lastSeq
      status("running", 1_000_000_004),
      message("post", "agent", 1_000_000_005),
    ]);
    expect(state.items).toHaveLength(4);
    expect(state.lastSeq).toBe(1_000_000_005);
  });
});

describe("reduceEvent — working state (agent working between send and reply)", () => {
  it("content sets working; done clears it", () => {
    let state: ChatState = initialChatState();
    state = reduceEvent(state, status("running"));
    expect(state.working).toBe(true);
    state = reduceEvent(state, message("working on it"));
    expect(state.working).toBe(true);
    state = reduceEvent(state, done("completed"));
    expect(state.working).toBe(false);
  });

  it("status waiting/stopped clears working", () => {
    const running = reduceEvent(initialChatState(), status("running"));
    expect(reduceEvent(running, status("waiting")).working).toBe(false);
    expect(reduceEvent(running, status("stopped")).working).toBe(false);
  });

  it("error and limit clear working", () => {
    const running = reduceEvent(initialChatState(), status("running"));
    expect(reduceEvent(running, error()).working).toBe(false);
    expect(reduceEvent(running, limit()).working).toBe(false);
  });

  it("tracks the last session state for the status line", () => {
    const state = reduceEvents(initialChatState(), [
      status("starting"),
      status("running"),
      status("waiting"),
    ]);
    expect(state.sessionState).toBe("waiting");
  });
});

describe("reduceLocalUserMessage — optimistic echo", () => {
  it("appends the user's message, flips working on, and uses a non-seq key", () => {
    const state = reduceLocalUserMessage(initialChatState(), "do the thing");
    expect(state.items).toHaveLength(1);
    const row = state.items[0];
    expect(row.kind).toBe("message");
    expect(row.key.startsWith("local-")).toBe(true);
    if (row.kind === "message") {
      expect(row.event.payload.role).toBe("user");
      expect(row.event.payload.text).toBe("do the thing");
    }
    expect(state.working).toBe(true);
  });

  it("does not disturb the seq dedup cursor (local items live outside seq space)", () => {
    const withWire = reduceEvent(initialChatState(), message("hi", "agent", 7));
    const withLocal = reduceLocalUserMessage(withWire, "reply");
    // A later wire event at seq 8 must still land.
    const after = reduceEvent(withLocal, message("agent reply", "agent", 8));
    expect(after.items).toHaveLength(3);
    expect(after.lastSeq).toBe(8);
  });
});

describe("reduceEvent — done mirrors the server status projection (Ф3)", () => {
  it("done(completed|max-turns) → waiting; done(stopped) → stopped", () => {
    const running = reduceEvent(initialChatState(), status("running"));
    expect(reduceEvent(running, done("completed")).sessionState).toBe("waiting");
    expect(reduceEvent(running, done("max-turns")).sessionState).toBe("waiting");
    expect(reduceEvent(running, done("stopped")).sessionState).toBe("stopped");
  });
});

describe("reduceEvent — wire user echo reconciles the optimistic copy (Ф2)", () => {
  it("a wire user message evicts the matching optimistic item (no duplicate)", () => {
    const optimistic = reduceLocalUserMessage(initialChatState(), "ship it");
    expect(optimistic.items).toHaveLength(1);
    const wired = reduceEvent(optimistic, message("ship it", "user", 5));
    const userRows = wired.items.filter((i) => i.kind === "message");
    expect(userRows).toHaveLength(1);
    expect(userRows[0].key).toBe("ev-5"); // the wire item (real seq), not the local-* echo
  });

  it("survives reconnect replay without duplicating the user echo", () => {
    // Live: optimistic → wire echo (seq 9) reconciles it → agent reply (seq 10).
    let state = reduceLocalUserMessage(initialChatState(), "hello");
    state = reduceEvent(state, message("hello", "user", 9));
    state = reduceEvent(state, message("hi back", "agent", 10));
    // Reconnect: the ring buffer replays 9 + 10; both already folded → dropped by seq dedup.
    state = reduceEvent(state, message("hello", "user", 9));
    state = reduceEvent(state, message("hi back", "agent", 10));
    const texts = state.items.map((i) => (i.kind === "message" ? i.event.payload.text : ""));
    expect(texts).toEqual(["hello", "hi back"]);
  });

  it("a wire user message with no optimistic match just appends", () => {
    const state = reduceEvent(initialChatState(), message("from elsewhere", "user", 3));
    expect(state.items).toHaveLength(1);
    expect(state.items[0].key).toBe("ev-3");
  });
});
