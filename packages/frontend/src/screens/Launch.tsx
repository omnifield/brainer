import { useNavigate } from "@solidjs/router";
import { createSignal, For, type JSX, Show } from "solid-js";
import { KNOWN_REPOS, KNOWN_SCOPES } from "../api/mock/fixtures";
import { toast } from "../lib/toast";
import { useFleet } from "../store/fleet";

// Launch — spawn a headless session. Pick repo + scope (the zone identity that drives role +
// permission on the backend) + optional model + brief, then POST /sessions and jump to its chat.
// The brief calls the extra params "role/model"; the wire field is `scope` (see contract.ts).

export function Launch(): JSX.Element {
  const { actions } = useFleet();
  const navigate = useNavigate();

  const [repo, setRepo] = createSignal(KNOWN_REPOS[0] ?? "");
  const [scope, setScope] = createSignal("kernel");
  const [model, setModel] = createSignal("");
  const [briefPath, setBriefPath] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy()) return;
    setBusy(true);
    setError("");
    try {
      const id = await actions.launch({
        repo: repo(),
        scope: scope(),
        model: model().trim() || undefined,
        brief: briefPath().trim() || undefined,
      });
      toast(`Session ${id} spawned`);
      navigate(`/s/${id}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div class="page-head">
        <div>
          <h1>Launch session</h1>
          <p>Spawn a headless agent session against a repo + scope.</p>
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
          <span>Model (optional)</span>
          <input
            value={model()}
            placeholder="claude-opus-4-8"
            onInput={(e) => setModel(e.currentTarget.value)}
          />
        </label>

        <label class="field">
          <span>Brief path (optional)</span>
          <input
            value={briefPath()}
            placeholder="briefs/control-channel-frontend.md"
            onInput={(e) => setBriefPath(e.currentTarget.value)}
          />
        </label>

        <Show when={error()}>
          <p class="chat-error-msg">{error()}</p>
        </Show>

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
