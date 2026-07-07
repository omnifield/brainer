import { createSignal } from "solid-js";

// Minimal transient-message signal for action feedback ("session spawned",
// "stopped"). Not persisted; purely UI affordance.

const [message, setMessage] = createSignal<string | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string): void {
  setMessage(text);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => setMessage(null), 2600);
}

export { message as toastMessage };
