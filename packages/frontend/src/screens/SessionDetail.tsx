import { A, useNavigate, useParams } from "@solidjs/router";
import { createResource, createSignal, For, type JSX, onCleanup, Show } from "solid-js";
import type { ActivityEvent } from "../api/types";
import { StatusBadge, TaskBadge } from "../components/StatusBadge";
import { formatRelative, formatUptime, isTerminal } from "../lib/format";
import { toast } from "../lib/toast";
import { useFleet } from "../store/fleet";

// Session detail — live activity feed + brief + tasks + stop/assign controls.
// Loads the detail via the contract, then tails the stream to grow the feed.

export function SessionDetail(): JSX.Element {
  const params = useParams();
  const navigate = useNavigate();
  const { state, actions, client } = useFleet();
  // Route is /sessions/:id, so the param is always present for this screen.
  const id = () => params.id as string;

  const [detail, { refetch }] = createResource(id, (sid) => client.getSession(sid));

  // Live feed, seeded with the last-known activity, grown by the stream.
  const [feed, setFeed] = createSignal<ActivityEvent[]>([]);
  const [briefDraft, setBriefDraft] = createSignal("");

  const unsub = client.streamSession(id(), (e) => {
    setFeed((prev) => [e, ...prev].slice(0, 50));
  });
  onCleanup(unsub);

  // Reflect the session's live status/uptime from the shared store when present.
  const liveSession = () => state.sessions.find((s) => s.id === id());

  const stop = async () => {
    await actions.stop(id());
    toast("Session stopped");
    void refetch();
  };

  const assignBrief = async (e: Event) => {
    e.preventDefault();
    const path = briefDraft().trim();
    if (!path) return;
    await actions.assignBrief(id(), { briefPath: path });
    toast("Brief assigned");
    setBriefDraft("");
    void refetch();
  };

  return (
    <Show when={detail()} fallback={<div class="empty">Loading session…</div>}>
      {(d) => (
        <>
          <div class="page-head">
            <div>
              <h1 class="mono">{d().scope}</h1>
              <p>
                <A href="/" class="dim">
                  ← Fleet
                </A>{" "}
                · <span class="mono dim">{d().repo}</span> · {d().role}
              </p>
            </div>
            <div class="row">
              <StatusBadge status={liveSession()?.status ?? d().status} />
              <button
                type="button"
                class="btn btn-danger btn-sm"
                disabled={isTerminal(liveSession()?.status ?? d().status)}
                onClick={stop}
              >
                Stop
              </button>
            </div>
          </div>

          <div class="detail-grid">
            <div class="card">
              <div class="col-head">Live activity</div>
              <div class="feed">
                <Show
                  when={feed().length > 0}
                  fallback={
                    <div class="feed-item">
                      <span class="feed-tool">{d().lastActivity.tool}</span>
                      <span class="dim">{d().lastActivity.summary}</span>
                      <span class="feed-time">{formatRelative(d().lastActivity.at)}</span>
                    </div>
                  }
                >
                  <For each={feed()}>
                    {(ev) => (
                      <div class="feed-item">
                        <span class="feed-tool">{ev.tool}</span>
                        <span class="dim">{ev.summary}</span>
                        <span class="feed-time">{formatRelative(ev.at)}</span>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>

            <div class="stack" style={{ gap: "20px" }}>
              <div class="card" style={{ padding: "16px" }}>
                <h3 class="section-title">Session</h3>
                <div class="meta-row">
                  <span class="k">Model</span>
                  <span class="mono">{d().model}</span>
                </div>
                <div class="meta-row">
                  <span class="k">Uptime</span>
                  <span class="mono">{formatUptime(d().startedAt)}</span>
                </div>
                <div class="meta-row">
                  <span class="k">Brief</span>
                  <span class="mono dim">{d().brief ?? "—"}</span>
                </div>
              </div>

              <div class="card" style={{ padding: "16px" }}>
                <h3 class="section-title">Tasks</h3>
                <Show
                  when={d().tasks.length > 0}
                  fallback={<span class="faint">No tasks assigned.</span>}
                >
                  <div class="stack" style={{ gap: "8px" }}>
                    <For each={d().tasks}>
                      {(t) => (
                        <div class="row">
                          <TaskBadge status={t.status} />
                          <span>{t.title}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              <form class="card" style={{ padding: "16px" }} onSubmit={assignBrief}>
                <h3 class="section-title">Assign brief</h3>
                <input
                  value={briefDraft()}
                  placeholder="briefs/some-brief.md"
                  onInput={(e) => setBriefDraft(e.currentTarget.value)}
                />
                <div class="row row-end" style={{ "margin-top": "10px" }}>
                  <button type="submit" class="btn btn-sm">
                    Assign
                  </button>
                </div>
              </form>
            </div>
          </div>

          <Show when={!liveSession()}>
            <p class="faint" style={{ "margin-top": "16px" }}>
              Session not in fleet list —{" "}
              <button type="button" class="btn btn-sm" onClick={() => navigate("/")}>
                back to Fleet
              </button>
            </p>
          </Show>
        </>
      )}
    </Show>
  );
}
