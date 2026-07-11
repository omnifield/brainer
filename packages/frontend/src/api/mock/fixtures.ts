import type { Session, Task } from "../types";

// Seed data for the mock adapter — a believable fleet so the dashboard is alive
// on first `npm run dev`, before any real backend exists.

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

export function seedSessions(): Session[] {
  return [
    {
      id: "s-arch-main",
      repo: "omnifield/brainer",
      scope: "main",
      role: "architect",
      status: "working",
      model: "claude-opus-4-8",
      startedAt: ago(184),
      lastActivity: { tool: "Write", at: ago(1), summary: "drafting orchestrator brief" },
    },
    {
      id: "s-fe",
      repo: "omnifield/brainer",
      scope: "frontend",
      role: "owner",
      status: "working",
      model: "claude-opus-4-8",
      startedAt: ago(96),
      lastActivity: { tool: "Edit", at: ago(0.4), summary: "src/screens/Fleet.tsx" },
    },
    {
      id: "s-kernel",
      repo: "omnifield/brainer",
      scope: "kernel",
      role: "owner",
      status: "blocked",
      model: "claude-sonnet-5",
      startedAt: ago(210),
      lastActivity: {
        tool: "prompt",
        at: ago(12),
        summary: "escalation: provider contract unclear",
      },
    },
    {
      id: "s-writer-be",
      repo: "omnifield/writer",
      scope: "backend",
      role: "owner",
      status: "idle",
      model: "claude-sonnet-5",
      startedAt: ago(320),
      lastActivity: { tool: "status", at: ago(28), summary: "awaiting brief" },
    },
    {
      id: "s-content",
      repo: "omnifield/brainer",
      scope: "content",
      role: "owner",
      status: "done",
      model: "claude-haiku-4-5",
      startedAt: ago(540),
      lastActivity: { tool: "Bash", at: ago(74), summary: "committed doc-etalon set" },
    },
    {
      id: "s-orch",
      repo: "omnifield/brainer",
      scope: "orchestrator",
      role: "owner",
      status: "error",
      model: "claude-opus-4-8",
      startedAt: ago(45),
      lastActivity: { tool: "Bash", at: ago(6), summary: "collector connection refused :4317" },
    },
  ];
}

export function seedTasks(): Task[] {
  return [
    { id: "t-1", sessionId: "s-fe", title: "Fleet screen — session table", status: "in-progress" },
    { id: "t-2", sessionId: "s-fe", title: "Mock ApiClient adapter", status: "done" },
    { id: "t-3", sessionId: "s-fe", title: "Task board interactions", status: "todo" },
    { id: "t-4", sessionId: "s-kernel", title: "agent-as-provider seam", status: "blocked" },
    { id: "t-5", sessionId: "s-arch-main", title: "Orchestrator brief", status: "in-progress" },
    { id: "t-6", sessionId: "s-orch", title: "OTEL telemetry aggregation", status: "todo" },
    { id: "t-7", sessionId: null, title: "Auth + entitlement (later phase)", status: "todo" },
  ];
}

export const SCOPE_ROLE: Record<string, "architect" | "owner"> = {
  main: "architect",
};
