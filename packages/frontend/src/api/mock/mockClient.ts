import { traced } from "../../lib/trace";
import type { ApiClient } from "../client";
import type {
  ActivityEvent,
  AssignBriefInput,
  CreateSessionInput,
  CreateTaskInput,
  Session,
  SessionDetail,
  SessionStatus,
  Task,
  Unsubscribe,
  UpdateTaskInput,
} from "../types";
import { SCOPE_ROLE, seedSessions, seedTasks } from "./fixtures";

// In-memory implementation of the ApiClient contract. Holds fleet state, answers
// the same shapes the real backend will, and simulates live telemetry so the UI
// visibly moves. Deterministic seams (no wall-clock coupling beyond timestamps)
// keep it unit-testable — see mockClient.test.ts.

const SIM_TOOLS = ["Read", "Edit", "Bash", "Grep", "Write", "prompt"] as const;

const SIM_SUMMARIES = [
  "reading src/api/client.ts",
  "running vitest",
  "grep contract types",
  "editing screen component",
  "npm run build",
  "planning next step",
];

export interface MockOptions {
  /** ms between simulated activity ticks per subscribed session. 0 disables. */
  tickMs?: number;
  /** injectable clock, for deterministic tests. */
  now?: () => number;
  /** injectable RNG in [0,1), for deterministic tests. */
  rand?: () => number;
}

export class MockApiClient implements ApiClient {
  private sessions: Session[];
  private tasks: Task[];
  private briefs = new Map<string, string | null>();
  private seq = 0;
  private readonly tickMs: number;
  private readonly now: () => number;
  private readonly rand: () => number;

  constructor(opts: MockOptions = {}) {
    this.sessions = seedSessions();
    this.tasks = seedTasks();
    this.tickMs = opts.tickMs ?? 2500;
    this.now = opts.now ?? (() => Date.now());
    this.rand = opts.rand ?? Math.random;
    for (const s of this.sessions) {
      this.briefs.set(s.id, s.scope === "frontend" ? "briefs/interface-mvp.md" : null);
    }
  }

  listSessions(): Promise<Session[]> {
    return traced("mock.listSessions", async () => this.sessions.map(clone));
  }

  createSession(input: CreateSessionInput): Promise<{ id: string }> {
    return traced("mock.createSession", async () => {
      const id = `s-${input.scope}-${this.nextId()}`;
      const role = SCOPE_ROLE[input.scope] ?? "owner";
      const at = new Date(this.now()).toISOString();
      const session: Session = {
        id,
        repo: input.repo,
        scope: input.scope,
        role,
        status: "working",
        model: "claude-opus-4-8",
        startedAt: at,
        lastActivity: { tool: "status", at, summary: "session spawned" },
      };
      this.sessions = [session, ...this.sessions];
      this.briefs.set(id, input.briefPath ?? null);
      return { id };
    });
  }

  getSession(id: string): Promise<SessionDetail> {
    return traced("mock.getSession", async () => {
      const session = this.require(id);
      return {
        ...clone(session),
        brief: this.briefs.get(id) ?? null,
        tasks: this.tasks.filter((t) => t.sessionId === id).map(clone),
      };
    });
  }

  stopSession(id: string): Promise<{ ok: boolean }> {
    return traced("mock.stopSession", async () => {
      const session = this.require(id);
      session.status = "done";
      session.lastActivity = {
        tool: "status",
        at: new Date(this.now()).toISOString(),
        summary: "stopped by operator",
      };
      return { ok: true };
    });
  }

  assignBrief(id: string, input: AssignBriefInput): Promise<{ ok: boolean }> {
    return traced("mock.assignBrief", async () => {
      this.require(id);
      const value = input.briefPath ?? input.briefText ?? null;
      this.briefs.set(id, value);
      return { ok: true };
    });
  }

  listTasks(): Promise<Task[]> {
    return traced("mock.listTasks", async () => this.tasks.map(clone));
  }

  createTask(input: CreateTaskInput): Promise<Task> {
    return traced("mock.createTask", async () => {
      const task: Task = {
        id: `t-${this.nextId()}`,
        sessionId: input.sessionId,
        title: input.title,
        status: input.status ?? "todo",
      };
      this.tasks = [...this.tasks, task];
      return clone(task);
    });
  }

  updateTask(id: string, patch: UpdateTaskInput): Promise<Task> {
    return traced("mock.updateTask", async () => {
      const task = this.tasks.find((t) => t.id === id);
      if (!task) throw new Error(`task not found: ${id}`);
      Object.assign(task, patch);
      return clone(task);
    });
  }

  streamSession(id: string, onEvent: (e: ActivityEvent) => void): Unsubscribe {
    const session = this.sessions.find((s) => s.id === id);
    // Terminal sessions don't emit; nothing to simulate.
    if (!session || this.tickMs <= 0 || isTerminal(session.status)) {
      return () => {};
    }
    const timer = setInterval(() => {
      const event = this.simulateEvent(id);
      if (event) onEvent(event);
    }, this.tickMs);
    return () => clearInterval(timer);
  }

  /** Produce one simulated activity event and fold it into session state. */
  simulateEvent(id: string): ActivityEvent | null {
    const session = this.sessions.find((s) => s.id === id);
    if (!session || isTerminal(session.status)) return null;
    const tool = pick(SIM_TOOLS, this.rand);
    const summary = pick(SIM_SUMMARIES, this.rand);
    const at = new Date(this.now()).toISOString();
    session.lastActivity = { tool, at, summary };
    // Occasionally flip status to keep the fleet view lively.
    if (this.rand() < 0.15) {
      session.status = session.status === "working" ? "idle" : "working";
    }
    return { sessionId: id, kind: "tool", tool, summary, at, status: session.status };
  }

  private require(id: string): Session {
    const session = this.sessions.find((s) => s.id === id);
    if (!session) throw new Error(`session not found: ${id}`);
    return session;
  }

  private nextId(): string {
    this.seq += 1;
    return `${this.seq}${Math.floor(this.rand() * 1000)}`;
  }
}

function isTerminal(status: SessionStatus): boolean {
  return status === "done" || status === "error";
}

function pick<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}
