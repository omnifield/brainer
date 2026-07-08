import { useNavigate } from "@solidjs/router";
import { createSignal, For, type JSX } from "solid-js";
import { KNOWN_REPOS, KNOWN_SCOPES } from "../api/mock/fixtures";
import { toast } from "../lib/toast";
import { useFleet } from "../store/fleet";

// Launch — spawn a session. Pick repo + scope (+ optional brief) → POST /sessions
// through the store, then jump to its detail. No business logic here beyond form
// state; the spawn itself is the contract call.

export function Launch(): JSX.Element {
  const { actions } = useFleet();
  const navigate = useNavigate();

  const [repo, setRepo] = createSignal(KNOWN_REPOS[0]!);
  const [scope, setScope] = createSignal("kernel");
  const [briefPath, setBriefPath] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy()) return;
    setBusy(true);
    try {
      const id = await actions.spawn({
        repo: repo(),
        scope: scope(),
        briefPath: briefPath().trim() || undefined,
      });
      toast(`Session ${id} spawned`);
      navigate(`/sessions/${id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div class="page-head">
        <div>
          <h1>Launch session</h1>
          <p>Spawn a claude-scope agent against a repo + scope.</p>
        </div>
      </div>

      <form class="form-card" onSubmit={submit}>
        <label class="field">
          <span>Repository</span>
          <select value={repo()} onChange={(e) => setRepo(e.currentTarget.value)}>
            <For each={KNOWN_REPOS}>{(r) => <option value={r}>{r}</option>}</For>
          </select>
        </label>

        <label class="field">
          <span>Scope</span>
          <select value={scope()} onChange={(e) => setScope(e.currentTarget.value)}>
            <For each={KNOWN_SCOPES}>
              {(sc) => (
                <option value={sc}>
                  {sc}
                  {sc === "main" ? " (architect)" : " (owner)"}
                </option>
              )}
            </For>
          </select>
        </label>

        <label class="field">
          <span>Brief path (optional)</span>
          <input
            value={briefPath()}
            placeholder="briefs/interface-mvp.md"
            onInput={(e) => setBriefPath(e.currentTarget.value)}
          />
        </label>

        <div class="row row-end">
          <button type="button" class="btn" onClick={() => navigate("/")}>
            Cancel
          </button>
          <button type="submit" class="btn btn-primary" disabled={busy()}>
            {busy() ? "Spawning…" : "Spawn session"}
          </button>
        </div>
      </form>
    </>
  );
}
