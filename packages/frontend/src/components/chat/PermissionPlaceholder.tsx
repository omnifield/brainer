import type { JSX } from "solid-js";
import type * as wire from "../../api/generated/events";

// permission-request is in the contract but claude-code does not emit it in MVP and forwarding is
// out of scope (backend README). Render a reserved placeholder so the type is handled, not dropped.
export function PermissionPlaceholder(props: { event: wire.PermissionRequestEvent }): JSX.Element {
  return (
    <div class="chat-permission" data-reserved="true">
      <span class="chat-permission-badge">permission</span>
      <span class="dim">{props.event.payload.tool} — reserved (forwarding not wired in MVP)</span>
    </div>
  );
}
