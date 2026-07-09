// SSE subscription to GET /sessions/:id/events. The browser's native EventSource does the heavy
// lifting: it auto-reconnects and re-sends the last `id:` it saw as the `Last-Event-ID` header, which
// the backend uses to replay only events past that seq. Combined with the reducer's seq-dedup, a
// dropped connection heals with no gaps and no duplicates (brief deliverable 2 / DoD).

import type { AgentSessionEvent } from "../generated/events";
import { backendUrl } from "./base";

export interface ChatStreamHandlers {
  onEvent: (event: AgentSessionEvent) => void;
  onOpen?: () => void;
  /** Fired on transport error; EventSource will reconnect on its own afterwards. */
  onError?: (err: Event) => void;
}

export interface ChatStream {
  close: () => void;
}

/** Constructor shape of the global EventSource — injectable so tests can drive a fake. */
export type EventSourceCtor = new (url: string) => EventSource;

/**
 * Open the live event stream for a session. Returns a handle whose `close()` tears down the
 * connection (call it on unmount). `EventSourceImpl` defaults to the global; tests pass a fake.
 */
export function openChatStream(
  sessionId: string,
  handlers: ChatStreamHandlers,
  EventSourceImpl: EventSourceCtor = EventSource,
): ChatStream {
  const url = backendUrl(`/sessions/${encodeURIComponent(sessionId)}/events`);
  const es = new EventSourceImpl(url);
  es.onopen = () => handlers.onOpen?.();
  es.onmessage = (msg: MessageEvent) => {
    const event = parseEvent(msg.data);
    if (event) handlers.onEvent(event);
  };
  es.onerror = (err: Event) => handlers.onError?.(err);
  return { close: () => es.close() };
}

/**
 * Parse one SSE `data:` payload into a contract event. Returns null (rather than throwing) for
 * anything that isn't a well-formed envelope, so a single malformed frame can't kill the stream.
 */
export function parseEvent(data: unknown): AgentSessionEvent | null {
  if (typeof data !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isEnvelope(parsed)) return null;
  return parsed as AgentSessionEvent;
}

function isEnvelope(value: unknown): value is { type: string; seq: number } {
  if (typeof value !== "object" || value === null) return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.type === "string" && typeof rec.seq === "number";
}
