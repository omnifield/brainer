import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import { sendMessage } from "../../api/backend/sessions";
import { openChatStream } from "../../api/backend/stream";
import { type ChatState, initialChatState, reduceEvent, reduceLocalUserMessage } from "./reducer";

// Thin Solid wrapper over the pure chat reducer (brief §Миграция: reactivity sits ON TOP, never
// woven in). Holds the reduced state in a signal, (re)subscribes to the SSE stream whenever the
// session id changes, and folds each event through the reducer. `send` echoes optimistically then
// posts to the backend. All logic worth testing lives in the reducer; this is just wiring.

export interface ChatController {
  state: Accessor<ChatState>;
  /** Optimistically echo the user's message, then POST it into the live session. Throws on failure. */
  send: (text: string) => Promise<void>;
}

export function useChat(sessionId: Accessor<string>): ChatController {
  const [state, setState] = createSignal<ChatState>(initialChatState());

  createEffect(() => {
    const id = sessionId();
    // New session → fresh feed + fresh cursor. EventSource reconnects and replays on its own.
    setState(initialChatState());
    const stream = openChatStream(id, {
      onEvent: (event) => setState((prev) => reduceEvent(prev, event)),
    });
    onCleanup(() => stream.close());
  });

  const send = async (text: string) => {
    setState((prev) => reduceLocalUserMessage(prev, text));
    await sendMessage(sessionId(), text);
  };

  return { state, send };
}
