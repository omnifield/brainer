import { createSignal, type JSX, Show } from "solid-js";
import type * as wire from "../../api/generated/events";

// A tool-call and its matching tool-result, collapsed into one compact row: tool name + status
// (pending → ok/error). Input + output expand on click. The reducer pairs them by call_id; this
// component just renders whichever of the two it was handed.
export function ToolPair(props: {
  call: wire.ToolCallEvent | null;
  result: wire.ToolResultEvent | null;
}): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const name = () => props.call?.payload.tool ?? "tool";
  const status = () => (!props.result ? "pending" : props.result.payload.is_error ? "error" : "ok");
  return (
    <div class="chat-tool" data-status={status()}>
      <button
        type="button"
        class="chat-tool-head"
        aria-expanded={open()}
        onClick={() => setOpen(!open())}
      >
        <span class="chat-chevron" aria-hidden="true" />
        <span class="chat-tool-name mono">{name()}</span>
        <span class="chat-tool-status">{status()}</span>
      </button>
      <Show when={open()}>
        <div class="chat-tool-detail">
          <Show when={props.call}>
            {(call) => <pre class="chat-code">{format(call().payload.input)}</pre>}
          </Show>
          <Show when={props.result}>
            {(result) => <pre class="chat-code">{format(result().payload.output)}</pre>}
          </Show>
        </div>
      </Show>
    </div>
  );
}

// Tool input/output are arbitrary JSON (unknown/open record on the wire) — render strings as-is,
// everything else pretty-printed.
function format(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
