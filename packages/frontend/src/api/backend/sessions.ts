// Control-channel REST calls (backend app/api/sessions.py). Thin wrappers — no state, no UI.
//   GET  /sessions                 → SessionSummary[]
//   POST /sessions                 → { id }
//   POST /sessions/:id/messages    → { ok }   (send into the live session)
//   POST /sessions/:id/stop        → { ok }
// The SSE events stream is separate — see stream.ts.

import { getJson, postJson } from "./base";
import type { LaunchInput, SessionSummary } from "./contract";

export function listSessions(): Promise<SessionSummary[]> {
  return getJson<SessionSummary[]>("/sessions");
}

export function launchSession(input: LaunchInput): Promise<{ id: string }> {
  return postJson<{ id: string }>("/sessions", input);
}

export function sendMessage(sessionId: string, text: string): Promise<{ ok: boolean }> {
  return postJson<{ ok: boolean }>(`/sessions/${encodeURIComponent(sessionId)}/messages`, { text });
}

export function stopSession(sessionId: string, force = false): Promise<{ ok: boolean }> {
  return postJson<{ ok: boolean }>(`/sessions/${encodeURIComponent(sessionId)}/stop`, { force });
}
