import { describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "../generated/events";
import { type ChatStream, openChatStream, parseEvent } from "./stream";

describe("parseEvent", () => {
  it("parses a well-formed envelope", () => {
    const raw = JSON.stringify({
      session_id: "s1",
      seq: 4,
      ts: "2026-07-09T00:00:00Z",
      type: "message",
      payload: { role: "agent", text: "hi" },
    });
    const event = parseEvent(raw);
    expect(event?.type).toBe("message");
    expect(event?.seq).toBe(4);
  });

  it("returns null for malformed JSON (a bad frame must not kill the stream)", () => {
    expect(parseEvent("{not json")).toBeNull();
  });

  it("returns null when the envelope lacks type/seq", () => {
    expect(parseEvent(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(parseEvent(JSON.stringify({ type: "message" }))).toBeNull();
  });

  it("returns null for non-string data", () => {
    expect(parseEvent(42)).toBeNull();
    expect(parseEvent(null)).toBeNull();
  });
});

// Minimal EventSource stand-in — jsdom ships none. Captures handlers so the test can emit frames.
class FakeEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((msg: MessageEvent) => void) | null = null;
  onerror: ((err: Event) => void) | null = null;
  closed = false;
  constructor(public url: string) {}
  emit(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }
  close() {
    this.closed = true;
  }
}

describe("openChatStream", () => {
  it("delivers parsed events and tears down on close", () => {
    let created: FakeEventSource | null = null;
    const Ctor = vi.fn((url: string) => {
      created = new FakeEventSource(url);
      return created;
    });
    const events: AgentSessionEvent[] = [];
    const stream: ChatStream = openChatStream(
      "sess-1",
      { onEvent: (e) => events.push(e) },
      Ctor as unknown as new (
        url: string,
      ) => EventSource,
    );

    const es = created as unknown as FakeEventSource;
    expect(es.url).toContain("/sessions/sess-1/events");
    es.emit(
      JSON.stringify({
        session_id: "s",
        seq: 1,
        ts: "t",
        type: "status",
        payload: { state: "running" },
      }),
    );
    es.emit("garbage");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("status");

    stream.close();
    expect(es.closed).toBe(true);
  });
});
