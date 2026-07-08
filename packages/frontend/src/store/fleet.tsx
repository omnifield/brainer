import { createContext, type JSX, useContext } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { ApiClient } from "../api/client";
import type {
  ActivityEvent,
  AssignBriefInput,
  CreateSessionInput,
  CreateTaskInput,
  Session,
  Task,
  TaskStatus,
  Unsubscribe,
} from "../api/types";
import { isTerminal } from "../lib/format";

// Reactive fleet state + actions. This is where the (little) client-orchestration
// logic lives, so screens stay dumb: they read `state` and call `actions`. The
// store owns nothing the contract doesn't — it mirrors the ApiClient responses.

export interface FleetState {
  sessions: Session[];
  tasks: Task[];
  loaded: boolean;
  error: string | null;
}

export interface FleetActions {
  load(): Promise<void>;
  spawn(input: CreateSessionInput): Promise<string>;
  stop(id: string): Promise<void>;
  assignBrief(id: string, input: AssignBriefInput): Promise<void>;
  addTask(input: CreateTaskInput): Promise<void>;
  setTaskStatus(id: string, status: TaskStatus): Promise<void>;
  /** Fold a streamed activity event into the matching session. */
  applyEvent(e: ActivityEvent): void;
  /** Subscribe live streams for all currently non-terminal sessions. */
  startLive(): void;
  stopLive(): void;
}

export function createFleetStore(client: ApiClient): [FleetState, FleetActions] {
  const [state, setState] = createStore<FleetState>({
    sessions: [],
    tasks: [],
    loaded: false,
    error: null,
  });

  const subs = new Map<string, Unsubscribe>();

  const applyEvent = (e: ActivityEvent) => {
    setState(
      produce((s) => {
        const session = s.sessions.find((x) => x.id === e.sessionId);
        if (!session) return;
        session.lastActivity = { tool: e.tool, at: e.at, summary: e.summary };
        if (e.status) session.status = e.status;
      }),
    );
  };

  const startLive = () => {
    for (const session of state.sessions) {
      if (subs.has(session.id) || isTerminal(session.status)) continue;
      subs.set(session.id, client.streamSession(session.id, applyEvent));
    }
  };

  const stopLive = () => {
    for (const unsub of subs.values()) unsub();
    subs.clear();
  };

  const actions: FleetActions = {
    async load() {
      try {
        const [sessions, tasks] = await Promise.all([client.listSessions(), client.listTasks()]);
        setState({ sessions, tasks, loaded: true, error: null });
      } catch (err) {
        setState("error", String(err));
      }
    },

    async spawn(input) {
      const { id } = await client.createSession(input);
      const sessions = await client.listSessions();
      setState("sessions", sessions);
      startLive();
      return id;
    },

    async stop(id) {
      await client.stopSession(id);
      const unsub = subs.get(id);
      if (unsub) {
        unsub();
        subs.delete(id);
      }
      setState(
        produce((s) => {
          const session = s.sessions.find((x) => x.id === id);
          if (session) session.status = "done";
        }),
      );
    },

    async assignBrief(id, input) {
      await client.assignBrief(id, input);
    },

    async addTask(input) {
      const task = await client.createTask(input);
      setState("tasks", (t) => [...t, task]);
    },

    async setTaskStatus(id, status) {
      const updated = await client.updateTask(id, { status });
      setState("tasks", (t) => t.map((x) => (x.id === id ? updated : x)));
    },

    applyEvent,
    startLive,
    stopLive,
  };

  return [state, actions];
}

// ---- context wiring (app shell) ----

const FleetContext = createContext<{
  state: FleetState;
  actions: FleetActions;
  client: ApiClient;
}>();

export function FleetProvider(props: { client: ApiClient; children: JSX.Element }): JSX.Element {
  const [state, actions] = createFleetStore(props.client);
  return (
    <FleetContext.Provider value={{ state, actions, client: props.client }}>
      {props.children}
    </FleetContext.Provider>
  );
}

export function useFleet() {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error("useFleet must be used within FleetProvider");
  return ctx;
}
