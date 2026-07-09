import { createSignal, type JSX, Show } from "solid-js";
import type * as wire from "../../api/generated/events";

// Reasoning trace — collapsed by default (brief), expanded on click. Local open state is view-only
// UI, not domain logic, so it lives here rather than in the reducer.
export function ThinkingBlock(props: { event: wire.ThinkingEvent }): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="chat-thinking" data-open={open()}>
      <button type="button" class="chat-thinking-toggle" onClick={() => setOpen(!open())}>
        <span class="chat-chevron" aria-hidden="true" />
        thinking
      </button>
      <Show when={open()}>
        <pre class="chat-thinking-text">{props.event.payload.text}</pre>
      </Show>
    </div>
  );
}
