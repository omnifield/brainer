import { createContext, type JSX, useContext } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { LaunchInput, SessionSummary } from "../api/backend/contract";
import { launchSession, listSessions, stopSession } from "../api/backend/sessions";
import type { ApiClient } from "../api/client";
import type { CreateTaskInput, Task, TaskStatus } from "../api/types";

// Fleet state + actions. Sessions are REAL now — the control-channel backend (listSessions /
// launch / stop). Task-board stays on the mock ApiClient (a parallel track, brief §Вне скоупа).
// The dead interface-MVP activity stream is gone: the chat view owns its own SSE (store/chat).
// Live session status is kept fresh by a light poll (the list projection has no push channel).

export interface FleetState {
  sessions: SessionSummary[];
  tasks: Task[];
  loaded: boolean;
  error: string | null;
}

export interface FleetActions {
  load(): Promise<void>;
  /** Launch a headless session; returns its id. Refreshes the list so it appears immediately. */
  launch(input: LaunchInput): Promise<string>;
  stop(id: string, force?: boolean): Promise<void>;
  addTask(input: CreateTaskInput): Promise<void>;
  setTaskStatus(id: string, status: TaskStatus): Promise<void>;
  /** Poll the session list so statuses stay live (the projection has no server push). */
  startPolling(intervalMs?: number): void;
  stopPolling(): void;
}

export function createFleetStore(client: ApiClient): [FleetState, FleetActions] {
  const [state, setState] = createStore<FleetState>({
    sessions: [],
    tasks: [],
    loaded: false,
    error: null,
  });

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const refreshSessions = async () => {
    try {
      const sessions = await listSessions();
      setState("sessions", sessions);
      setState("error", null);
    } catch (err) {
      setState("error", String(err));
    }
  };

  const actions: FleetActions = {
    async load() {
      try {
        const [sessions, tasks] = await Promise.all([listSessions(), client.listTasks()]);
        setState({ sessions, tasks, loaded: true, error: null });
      } catch (err) {
        setState({ loaded: true, error: String(err) });
      }
    },

    async launch(input) {
      const { id } = await launchSession(input);
      await refreshSessions();
      return id;
    },

    async stop(id, force = false) {
      await stopSession(id, force);
      await refreshSessions();
    },

    async addTask(input) {
      const task = await client.createTask(input);
      setState("tasks", (t) => [...t, task]);
    },

    async setTaskStatus(id, status) {
      const updated = await client.updateTask(id, { status });
      setState(
        produce((s) => {
          const idx = s.tasks.findIndex((t) => t.id === id);
          if (idx !== -1) s.tasks[idx] = updated;
        }),
      );
    },

    startPolling(intervalMs = 5000) {
      actions.stopPolling();
      pollTimer = setInterval(() => void refreshSessions(), intervalMs);
    },

    stopPolling() {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    },
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
