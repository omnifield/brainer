import type { JSX } from "solid-js";
import { Show } from "solid-js";
import type * as wire from "../../api/generated/events";

// Errors are surfaced prominently and stay in the feed (brief: "заметно, не тостом-однодневкой").
export function ErrorNotice(props: { event: wire.ErrorEvent }): JSX.Element {
  return (
    <div class="chat-error" role="alert">
      <div class="chat-error-head">
        <span class="chat-error-code mono">{props.event.payload.code}</span>
        <Show when={props.event.payload.retryable}>
          <span class="chat-error-retry">retryable</span>
        </Show>
      </div>
      <div class="chat-error-msg">{props.event.payload.message}</div>
    </div>
  );
}
