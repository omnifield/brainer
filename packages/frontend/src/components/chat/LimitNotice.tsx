import type { JSX } from "solid-js";
import { Show } from "solid-js";
import type * as wire from "../../api/generated/events";

// Rate/account limit hit — surfaced prominently alongside errors, with the reset time when known.
export function LimitNotice(props: { event: wire.LimitEvent }): JSX.Element {
  return (
    <div class="chat-limit" role="alert" data-scope={props.event.payload.scope}>
      <span class="chat-limit-label">rate limit · {props.event.payload.scope}</span>
      <Show when={props.event.payload.resets_at}>
        {(resets) => <span class="dim">resets {resets()}</span>}
      </Show>
    </div>
  );
}
