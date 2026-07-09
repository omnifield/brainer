// Chat-feed reducer — pure logic, ZERO DOM/Solid (brief §Миграция: this is the future HCA
// Controller; Solid reactivity is a thin wrapper on top, never woven in here). Folds the raw
// SSE event stream into an ordered feed the view renders 1:1. Responsibilities:
//   • seq-dedup + reconnect splice (drop any event whose seq we've already folded)
//   • pair tool-call/tool-result by call_id into one row
//   • track "agent working" between a send and the reply
//   • optimistic echo of the user's own message (the provider never emits role="user")
// The view eats generated contract types as-is (`wire.*`) — no parallel hand-written domain types.

import type * as wire from "../../api/generated/events";

/** One rendered row. Tool-call + tool-result collapse into a single `tool` row keyed by call_id. */
export type FeedItem =
  | { kind: "message"; key: string; event: wire.MessageEvent }
  | { kind: "thinking"; key: string; event: wire.ThinkingEvent }
  | {
      kind: "tool";
      key: string;
      call: wire.ToolCallEvent | null;
      result: wire.ToolResultEvent | null;
    }
  | { kind: "status"; key: string; event: wire.StatusEvent }
  | { kind: "done"; key: string; event: wire.DoneEvent }
  | { kind: "error"; key: string; event: wire.ErrorEvent }
  | { kind: "limit"; key: string; event: wire.LimitEvent }
  | { kind: "permission"; key: string; event: wire.PermissionRequestEvent };

export type SessionState = wire.StatusPayload["state"];

export interface ChatState {
  items: FeedItem[];
  /** Highest wire `seq` folded so far; the dedup/reconnect cursor. -1 = nothing seen yet. */
  lastSeq: number;
  /** Agent is producing or a sent message is awaiting its reply (drives the "working" indicator). */
  working: boolean;
  /** Last status the session reported, for the status line. */
  sessionState: SessionState | null;
  /** Counter for optimistic (non-wire) item keys, kept out of the seq space. */
  localSeq: number;
}

export function initialChatState(): ChatState {
  return { items: [], lastSeq: -1, working: false, sessionState: null, localSeq: 0 };
}

/**
 * Fold one wire event into the state, returning a NEW state (never mutates the input).
 * Events with seq <= lastSeq are dropped — this is the whole dedup story: a fresh connect replays
 * the ring buffer and a reconnect replays seq > Last-Event-ID, so the monotone cursor makes both
 * idempotent, including across the resume epoch jump (seq stays monotone).
 */
export function reduceEvent(state: ChatState, event: wire.AgentSessionEvent): ChatState {
  if (event.seq <= state.lastSeq) return state;
  const next: ChatState = { ...state, lastSeq: event.seq };

  switch (event.type) {
    // Content the agent produces → it is actively working.
    case "message":
      next.working = true;
      return append(next, { kind: "message", key: keyOf(event), event });
    case "thinking":
      next.working = true;
      return append(next, { kind: "thinking", key: keyOf(event), event });
    case "tool-call":
      next.working = true;
      return append(next, { kind: "tool", key: keyOf(event), call: event, result: null });
    case "tool-result":
      return foldToolResult(next, event);
    case "status":
      next.sessionState = event.payload.state;
      next.working = event.payload.state === "starting" || event.payload.state === "running";
      return append(next, { kind: "status", key: keyOf(event), event });
    // Terminal / paused signals → not working.
    case "done":
      next.working = false;
      return append(next, { kind: "done", key: keyOf(event), event });
    case "error":
      next.working = false;
      return append(next, { kind: "error", key: keyOf(event), event });
    case "limit":
      next.working = false;
      return append(next, { kind: "limit", key: keyOf(event), event });
    case "permission-request":
      // Waiting on a human, but the session hasn't produced a terminal signal — leave working as-is.
      return append(next, { kind: "permission", key: keyOf(event), event });
    default:
      // Unknown/forward-compat event type: cursor already advanced (dedup holds); render nothing.
      return next;
  }
}

/** Convenience fold used by tests and the initial replay: apply many events in order. */
export function reduceEvents(state: ChatState, events: wire.AgentSessionEvent[]): ChatState {
  return events.reduce(reduceEvent, state);
}

/**
 * Optimistically append the user's own message. The provider only ever emits role="agent", so this
 * never collides with a wire event; it carries a `local-*` key outside the seq space and flips the
 * session to "working" until the reply arrives.
 */
export function reduceLocalUserMessage(state: ChatState, text: string): ChatState {
  const localSeq = state.localSeq + 1;
  const event: wire.MessageEvent = {
    session_id: "",
    seq: -1,
    ts: "",
    type: "message",
    payload: { role: "user", text },
  };
  const item: FeedItem = { kind: "message", key: `local-${localSeq}`, event };
  return { ...state, items: [...state.items, item], working: true, localSeq };
}

function keyOf(event: wire.AgentSessionEvent): string {
  return `ev-${event.seq}`;
}

function append(state: ChatState, item: FeedItem): ChatState {
  return { ...state, items: [...state.items, item] };
}

/** Attach a tool-result to its pending tool row (matched by call_id); orphan results start a new row. */
function foldToolResult(state: ChatState, event: wire.ToolResultEvent): ChatState {
  const callId = event.payload.call_id;
  const next: ChatState = { ...state, working: true };
  const idx = state.items.findIndex(
    (it) => it.kind === "tool" && it.result === null && it.call?.payload.call_id === callId,
  );
  if (idx === -1) {
    return append(next, { kind: "tool", key: keyOf(event), call: null, result: event });
  }
  const items = state.items.slice();
  const row = items[idx] as Extract<FeedItem, { kind: "tool" }>;
  items[idx] = { ...row, result: event };
  return { ...next, items };
}
