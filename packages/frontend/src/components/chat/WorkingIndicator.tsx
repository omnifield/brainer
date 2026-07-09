import type { JSX } from "solid-js";
import { Show } from "solid-js";

// The "agent is working" affordance shown between a send and the reply (reducer owns the flag).
export function WorkingIndicator(props: { working: boolean }): JSX.Element {
  return (
    <Show when={props.working}>
      <div class="chat-working" aria-live="polite">
        <span class="chat-working-dot" aria-hidden="true" />
        agent working…
      </div>
    </Show>
  );
}
