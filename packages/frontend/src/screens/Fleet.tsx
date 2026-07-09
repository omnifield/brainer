import { useNavigate } from "@solidjs/router";
import { For, type JSX, Show } from "solid-js";
import { StatusBadge } from "../components/StatusBadge";
import { formatUptime } from "../lib/format";
import { useFleet } from "../store/fleet";

// Fleet — the main screen. Every live session at a glance (the "don't lose control" core). Dumb:
// reads the real session projection from the store and renders. Clicking a row opens its chat.

export function Fleet(): JSX.Element {
  const { state } = useFleet();
  const navigate = useNavigate();
  const running = () => state.sessions.filter((s) => s.status === "running").length;

  return (
    <>
      <div class="page-head">
        <div>
          <h1>Fleet</h1>
          <p>
            {state.sessions.length} sessions · {running()} running
          </p>
        </div>
        <button type="button" class="btn btn-primary" onClick={() => navigate("/launch")}>
          + Launch session
        </button>
      </div>

      <Show
        when={state.sessions.length > 0}
        fallback={<div class="card empty">No sessions. Launch one to begin.</div>}
      >
        <div class="card">
          <table>
            <thead>
              <tr>
                <th>Zone</th>
                <th>Repo</th>
                <th>Status</th>
                <th>Started</th>
                <th>Session</th>
              </tr>
            </thead>
            <tbody>
              <For each={state.sessions}>
                {(s) => (
                  <tr onClick={() => navigate(`/s/${s.session_id}`)}>
                    <td class="mono">{s.role}</td>
                    <td class="mono dim">{s.repo}</td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td class="mono dim">{formatUptime(s.created_at)}</td>
                    <td class="mono faint">{s.session_id}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </>
  );
}
