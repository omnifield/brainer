import type { JSX } from "solid-js";
import { Show } from "solid-js";
import type * as wire from "../../api/generated/events";

// Turn boundary — the agent finished (completed / max-turns / stopped / error), with per-turn usage.
export function DoneLine(props: { event: wire.DoneEvent }): JSX.Element {
  const usage = () => props.event.payload.usage;
  return (
    <div class="chat-done" data-reason={props.event.payload.reason}>
      <span class="chat-done-reason">{props.event.payload.reason}</span>
      <span class="chat-done-usage mono dim">
        {usage().input_tokens}↑ {usage().output_tokens}↓
        <Show when={usage().cost_usd != null}>
          {" · $"}
          {usage().cost_usd?.toFixed(4)}
        </Show>
      </span>
    </div>
  );
}
