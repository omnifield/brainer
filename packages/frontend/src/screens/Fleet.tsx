import { useNavigate } from "@solidjs/router";
import { For, type JSX, Show } from "solid-js";
import { StatusBadge } from "../components/StatusBadge";
import { formatRelative, formatUptime } from "../lib/format";
import { useFleet } from "../store/fleet";

// Fleet — the main screen. Every session at a glance: the "don't lose control"
// core. Dumb: reads store state, renders. Live activity flows in via the store's
// stream subscriptions (started in the app shell).

export function Fleet(): JSX.Element {
  const { state } = useFleet();
  const navigate = useNavigate();
  const active = () => state.sessions.filter((s) => s.status === "working").length;

  return (
    <>
      <div class="page-head">
        <div>
          <h1>Fleet</h1>
          <p>
            {state.sessions.length} sessions · {active()} working
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
                <th>Scope</th>
                <th>Repo</th>
                <th>Role</th>
                <th>Status</th>
                <th>Model</th>
                <th>Uptime</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              <For each={state.sessions}>
                {(s) => (
                  <tr onClick={() => navigate(`/sessions/${s.id}`)}>
                    <td class="mono">{s.scope}</td>
                    <td class="mono dim">{s.repo}</td>
                    <td class="dim">{s.role}</td>
                    <td>
                      <StatusBadge status={s.status} />
                    </td>
                    <td class="mono faint">{s.model}</td>
                    <td class="mono dim">{formatUptime(s.startedAt)}</td>
                    <td>
                      <div class="stack">
                        <span>
                          <span class="mono" style={{ color: "var(--accent)" }}>
                            {s.lastActivity.tool}
                          </span>{" "}
                          <span class="dim">{s.lastActivity.summary}</span>
                        </span>
                        <span class="faint" style={{ "font-size": "11px" }}>
                          {formatRelative(s.lastActivity.at)}
                        </span>
                      </div>
                    </td>
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
