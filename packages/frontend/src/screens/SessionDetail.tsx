import { A, useParams } from "@solidjs/router";
import type { JSX } from "solid-js";
import { ChatFeed } from "../components/chat/ChatFeed";
import { SendBox } from "../components/chat/SendBox";
import { StatusBadge } from "../components/StatusBadge";
import { isTerminal } from "../lib/format";
import { toast } from "../lib/toast";
import { useChat } from "../store/chat/useChat";
import { useFleet } from "../store/fleet";

// Session detail = the chat view of one live session. The feed is built entirely from the SSE
// stream (folded by the reducer via useChat); session meta comes from the fleet list projection.
// Composition only — every event type is rendered by its own component inside ChatFeed.

export function SessionDetail(): JSX.Element {
  const params = useParams();
  const { state: fleet, actions } = useFleet();
  const id = () => params.id as string;
  const summary = () => fleet.sessions.find((s) => s.session_id === id());
  const { state, send } = useChat(id);

  // The live stream's last status wins; fall back to the list projection until the first event.
  const status = () => state().sessionState ?? summary()?.status ?? "starting";
  const terminated = () => isTerminal(status());

  const onSend = async (text: string) => {
    try {
      await send(text);
    } catch (err) {
      toast(String(err));
    }
  };

  const stop = async () => {
    await actions.stop(id());
    toast("Session stopped");
  };

  return (
    <div class="chat-screen">
      <div class="page-head">
        <div>
          <h1 class="mono">{summary()?.role ?? id()}</h1>
          <p>
            <A href="/" class="dim">
              ← Fleet
            </A>{" "}
            · <span class="mono dim">{summary()?.repo ?? "—"}</span> ·{" "}
            <span class="mono faint">{id()}</span>
          </p>
        </div>
        <div class="row">
          <StatusBadge status={status()} />
          <button
            type="button"
            class="btn btn-danger btn-sm"
            disabled={terminated()}
            onClick={stop}
          >
            Stop
          </button>
        </div>
      </div>

      <ChatFeed items={state().items} working={state().working} />
      <SendBox disabled={terminated()} onSend={onSend} />
    </div>
  );
}
