import { createSignal, type JSX } from "solid-js";

// Compose box for sending into the live session. Enter submits, Shift+Enter newlines. Presentational:
// it emits text via onSend and owns only its draft; the screen wires the actual send side-effect.
export function SendBox(props: {
  disabled?: boolean;
  onSend: (text: string) => void;
}): JSX.Element {
  const [text, setText] = createSignal("");

  const submit = (e: Event) => {
    e.preventDefault();
    const value = text().trim();
    if (!value) return;
    props.onSend(value);
    setText("");
  };

  return (
    <form class="chat-send" onSubmit={submit}>
      <textarea
        class="chat-send-input"
        value={text()}
        placeholder="Message the session…"
        rows={2}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) submit(e);
        }}
      />
      <button type="submit" class="btn btn-sm" disabled={props.disabled || !text().trim()}>
        Send
      </button>
    </form>
  );
}
