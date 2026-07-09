import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import type * as wire from "../../api/generated/events";
import type { FeedItem } from "../../store/chat/reducer";
import { ChatFeed } from "./ChatFeed";

// Smoke test: every feed-item kind renders without throwing and shows its key content. The reducer
// has the logic tests; this guards the presentational dispatch + each component's markup.
function sampleItems(): FeedItem[] {
  const env = { session_id: "s", ts: "t" };
  return [
    {
      kind: "message",
      key: "1",
      event: {
        ...env,
        seq: 1,
        type: "message",
        payload: { role: "agent", text: "hello world" },
      } as wire.MessageEvent,
    },
    {
      kind: "thinking",
      key: "2",
      event: {
        ...env,
        seq: 2,
        type: "thinking",
        payload: { text: "pondering" },
      } as wire.ThinkingEvent,
    },
    {
      kind: "tool",
      key: "3",
      call: {
        ...env,
        seq: 3,
        type: "tool-call",
        payload: { call_id: "c1", tool: "Bash", input: { cmd: "ls" } },
      } as wire.ToolCallEvent,
      result: {
        ...env,
        seq: 4,
        type: "tool-result",
        payload: { call_id: "c1", output: { out: "ok" }, is_error: false },
      } as wire.ToolResultEvent,
    },
    {
      kind: "status",
      key: "5",
      event: {
        ...env,
        seq: 5,
        type: "status",
        payload: { state: "running", detail: "init" },
      } as wire.StatusEvent,
    },
    {
      kind: "done",
      key: "6",
      event: {
        ...env,
        seq: 6,
        type: "done",
        payload: {
          reason: "completed",
          usage: { input_tokens: 10, output_tokens: 20, cost_usd: 0.01 },
        },
      } as wire.DoneEvent,
    },
    {
      kind: "error",
      key: "7",
      event: {
        ...env,
        seq: 7,
        type: "error",
        payload: { code: "boom", message: "it broke", retryable: true },
      } as wire.ErrorEvent,
    },
    {
      kind: "limit",
      key: "8",
      event: {
        ...env,
        seq: 8,
        type: "limit",
        payload: { scope: "rate", resets_at: null },
      } as wire.LimitEvent,
    },
    {
      kind: "permission",
      key: "9",
      event: {
        ...env,
        seq: 9,
        type: "permission-request",
        payload: { request_id: "r", tool: "Write", input: {} },
      } as wire.PermissionRequestEvent,
    },
  ];
}

describe("ChatFeed", () => {
  it("renders every feed-item kind and surfaces its content", () => {
    const { getByText, container } = render(() => (
      <ChatFeed items={sampleItems()} working={false} />
    ));
    expect(getByText("hello world")).toBeInTheDocument();
    expect(getByText("Bash")).toBeInTheDocument();
    expect(getByText("completed")).toBeInTheDocument();
    expect(getByText("it broke")).toBeInTheDocument();
    // one row per item
    expect(container.querySelectorAll(".chat-feed > *").length).toBe(sampleItems().length);
  });

  it("shows the working indicator only when working", () => {
    const [working, setWorking] = createSignal(true);
    const { queryByText } = render(() => <ChatFeed items={[]} working={working()} />);
    expect(queryByText("agent working…")).toBeInTheDocument();
    setWorking(false);
    expect(queryByText("agent working…")).not.toBeInTheDocument();
  });
});
