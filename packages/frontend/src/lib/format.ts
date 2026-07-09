import type { TaskStatus } from "../api/types";
import type { SessionState } from "../store/chat/reducer";

// Pure presentation helpers — no DOM, no framework. Unit-tested (format.test.ts)
// so the "dumb UI" reads these instead of embedding logic in components.

/** Human uptime from an ISO start to `now` (ms epoch). Coarse, single unit. */
export function formatUptime(startedAtIso: string, now: number = Date.now()): string {
  const start = Date.parse(startedAtIso);
  if (Number.isNaN(start)) return "—";
  const secs = Math.max(0, Math.floor((now - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** "just now" / "3m ago" / "2h ago" relative label. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Control-channel session status vocabulary (kernel StatusPayload.state).
export const STATUS_LABEL: Record<SessionState, string> = {
  starting: "Starting",
  running: "Running",
  waiting: "Waiting",
  stopped: "Stopped",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To do",
  "in-progress": "In progress",
  blocked: "Blocked",
  done: "Done",
};

export const SESSION_STATUSES: SessionState[] = ["starting", "running", "waiting", "stopped"];
export const TASK_STATUSES: TaskStatus[] = ["todo", "in-progress", "blocked", "done"];

/** True when a session can no longer act (used to gate the stop/send controls). */
export function isTerminal(status: SessionState): boolean {
  return status === "stopped";
}
