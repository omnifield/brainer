import type { JSX } from "solid-js";
import type * as wire from "../../api/generated/events";

// A dialogue reply. role (agent|user) drives colour/side via a data attribute — theming lives in CSS.
export function MessageBubble(props: { event: wire.MessageEvent }): JSX.Element {
  return (
    <div class="chat-msg" data-role={props.event.payload.role}>
      <span class="chat-msg-role">{props.event.payload.role}</span>
      <div class="chat-msg-text">{props.event.payload.text}</div>
    </div>
  );
}
