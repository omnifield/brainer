import type { JSX } from "solid-js";
import { Show } from "solid-js";
import type * as wire from "../../api/generated/events";

// Session state marker (starting/running/waiting/stopped) — a quiet inline line, not a bubble.
export function StatusLine(props: { event: wire.StatusEvent }): JSX.Element {
  return (
    <div class="chat-status" data-state={props.event.payload.state}>
      <span class="chat-status-dot" aria-hidden="true" />
      <span class="chat-status-state">{props.event.payload.state}</span>
      <Show when={props.event.payload.detail}>
        {(detail) => <span class="dim">{detail()}</span>}
      </Show>
    </div>
  );
}
