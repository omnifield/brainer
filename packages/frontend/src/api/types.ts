// Contract types — the shape the brief fixes (briefs/interface-mvp.md §Контракт).
// Mock adapter and the future real backend both satisfy these; the UI reads them
// and knows nothing about which provider is behind the seam.

export type SessionStatus = "idle" | "working" | "blocked" | "done" | "error";

/** Agent role, per claude-scope (architect on main, owner-<zone> elsewhere). */
export type Role = "architect" | "owner";

export type TaskStatus = "todo" | "in-progress" | "blocked" | "done";

/** A single telemetry data point — last observed activity for a session. */
export interface Activity {
  /** Tool or event name (e.g. "Edit", "Bash", "prompt", "status"). */
  tool: string;
  /** ISO timestamp. */
  at: string;
  summary: string;
}

export interface Session {
  id: string;
  repo: string;
  scope: string;
  role: Role;
  status: SessionStatus;
  model: string;
  /** ISO timestamp of session spawn. */
  startedAt: string;
  lastActivity: Activity;
}

export interface Task {
  id: string;
  sessionId: string | null;
  title: string;
  status: TaskStatus;
}

/** GET /api/sessions/:id — session plus its assigned brief and tasks. */
export interface SessionDetail extends Session {
  brief: string | null;
  tasks: Task[];
}

/** A live activity event pushed over the stream (SSE in the real adapter). */
export interface ActivityEvent {
  sessionId: string;
  kind: "tool" | "prompt" | "status";
  tool: string;
  summary: string;
  at: string;
  /** Present when kind === "status": the new session status. */
  status?: SessionStatus;
}

// ---- request payloads ----

export interface CreateSessionInput {
  repo: string;
  scope: string;
  briefPath?: string;
}

export interface AssignBriefInput {
  briefPath?: string;
  briefText?: string;
}

export interface CreateTaskInput {
  sessionId: string | null;
  title: string;
  status?: TaskStatus;
}

export type UpdateTaskInput = Partial<Pick<Task, "title" | "status" | "sessionId">>;

export type Unsubscribe = () => void;
