import type {
  ActivityEvent,
  AssignBriefInput,
  CreateSessionInput,
  CreateTaskInput,
  Session,
  SessionDetail,
  Task,
  Unsubscribe,
  UpdateTaskInput,
} from "./types";

// The ONE seam (brief §Ключ). Every screen talks to this interface only; the
// mock adapter and the future REST adapter are two implementations selected by
// config — never a branch inside a component. Swapping mock→real = new adapter,
// not a rewrite.
export interface ApiClient {
  // GET /api/sessions
  listSessions(): Promise<Session[]>;
  // POST /api/sessions -> { id }
  createSession(input: CreateSessionInput): Promise<{ id: string }>;
  // GET /api/sessions/:id
  getSession(id: string): Promise<SessionDetail>;
  // GET /api/sessions/:id/stream (SSE). Returns an unsubscribe handle.
  streamSession(id: string, onEvent: (e: ActivityEvent) => void): Unsubscribe;
  // POST /api/sessions/:id/stop
  stopSession(id: string): Promise<{ ok: boolean }>;
  // POST /api/sessions/:id/brief
  assignBrief(id: string, input: AssignBriefInput): Promise<{ ok: boolean }>;
  // GET /api/tasks
  listTasks(): Promise<Task[]>;
  // POST /api/tasks
  createTask(input: CreateTaskInput): Promise<Task>;
  // PATCH /api/tasks/:id
  updateTask(id: string, patch: UpdateTaskInput): Promise<Task>;
}
