// BFF transport shapes for the control-channel REST surface (backend app/api/sessions.py +
// app/channel/hub.py). These are the BFF envelope, NOT kernel-contract domain entities, and have
// no published JSON-schema to generate from — so they are mirrored here by hand and, like the
// backend README states, "the launch/stop/events/messages shapes are shared with the frontend;
// change only via architect". snake_case, because the BFF translates nothing.
//
// The event stream itself (the actual domain) IS schema-generated — see api/generated/events.ts.

import type { SessionState } from "../../store/chat/reducer";

/** GET /sessions — one row of the list projection (hub.SessionSummary). */
export interface SessionSummary {
  session_id: string;
  provider: string;
  role: string;
  repo: string;
  status: SessionState;
  sdk_session_id: string | null;
  created_at: string;
  updated_at: string;
}

/** POST /sessions — headless launch. `scope` is the zone identity (main/backend/…); the backend
 * derives role + permission from it. The brief calls this "role/model"; the wire field is `scope`. */
export interface LaunchInput {
  repo: string;
  scope: string;
  brief?: string;
  model?: string;
}
