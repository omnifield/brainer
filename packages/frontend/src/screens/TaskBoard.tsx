import { A } from "@solidjs/router";
import { createSignal, For, type JSX, Show } from "solid-js";
import type { Task, TaskStatus } from "../api/types";
import { TASK_STATUS_LABEL, TASK_STATUSES } from "../lib/format";
import { useFleet } from "../store/fleet";

// Task board — every task across every session, as a kanban. Interactive: add a
// task, change status via the per-card select (writes through the contract).

export function TaskBoard(): JSX.Element {
  const { state, actions } = useFleet();

  const [title, setTitle] = createSignal("");
  const [sessionId, setSessionId] = createSignal<string>("");

  const byStatus = (status: TaskStatus) => state.tasks.filter((t) => t.status === status);
  const sessionScope = (id: string | null) =>
    state.sessions.find((s) => s.session_id === id)?.role ?? "unassigned";

  const add = async (e: Event) => {
    e.preventDefault();
    const t = title().trim();
    if (!t) return;
    await actions.addTask({ title: t, sessionId: sessionId() || null });
    setTitle("");
  };

  return (
    <>
      <div class="page-head">
        <div>
          <h1>Task board</h1>
          <p>{state.tasks.length} tasks across the fleet</p>
        </div>
      </div>

      <form class="row" style={{ "margin-bottom": "20px" }} onSubmit={add}>
        <input
          style={{ "max-width": "420px" }}
          value={title()}
          placeholder="New task title…"
          onInput={(e) => setTitle(e.currentTarget.value)}
        />
        <select
          style={{ "max-width": "220px" }}
          value={sessionId()}
          onChange={(e) => setSessionId(e.currentTarget.value)}
        >
          <option value="">Unassigned</option>
          <For each={state.sessions}>
            {(s) => (
              <option value={s.session_id}>
                {s.role} · {s.repo}
              </option>
            )}
          </For>
        </select>
        <button type="submit" class="btn btn-primary">
          Add task
        </button>
      </form>

      <div class="board">
        <For each={TASK_STATUSES}>
          {(status) => (
            <div class="col">
              <div class="col-head">
                {TASK_STATUS_LABEL[status]}
                <span class="nav-count">{byStatus(status).length}</span>
              </div>
              <div class="col-body">
                <Show
                  when={byStatus(status).length > 0}
                  fallback={
                    <span class="faint" style={{ padding: "4px" }}>
                      —
                    </span>
                  }
                >
                  <For each={byStatus(status)}>
                    {(t) => <TaskCard task={t} scope={sessionScope(t.sessionId)} />}
                  </For>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </>
  );
}

function TaskCard(props: { task: Task; scope: string }): JSX.Element {
  const { actions } = useFleet();
  return (
    <div class="tcard">
      <div class="ttitle">{props.task.title}</div>
      <div class="tmeta">
        <Show when={props.task.sessionId} fallback={<span class="faint">unassigned</span>}>
          <A href={`/sessions/${props.task.sessionId}`} class="mono">
            {props.scope}
          </A>
        </Show>
        <span class="spacer" />
        <select
          value={props.task.status}
          onChange={(e) =>
            actions.setTaskStatus(props.task.id, e.currentTarget.value as TaskStatus)
          }
        >
          <For each={TASK_STATUSES}>{(s) => <option value={s}>{TASK_STATUS_LABEL[s]}</option>}</For>
        </select>
      </div>
    </div>
  );
}
