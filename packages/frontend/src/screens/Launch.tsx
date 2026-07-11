import { useNavigate } from "@solidjs/router";
import { createSignal, For, type JSX, Show } from "solid-js";
import { toast } from "../lib/toast";
import { useFleet } from "../store/fleet";
import { roleForScope, SUGGESTED_REPOS, SUGGESTED_SCOPES } from "./launch-suggestions";

// Launch — spawn a headless session. Type any repo + scope (the zone identity that drives role +
// permission on the backend) + optional model + brief, then POST /sessions and jump to its chat.
// The brief calls the extra params "role/model"; the wire field is `scope` (see contract.ts).
//
// Repo/scope are free-text (`<input>` + `<datalist>`): the backend registry — not a hardcoded
// frontend list — decides what actually resolves, so any value must be typeable. Suggestions are
// hints only (see launch-suggestions.ts). An unknown repo comes back as a readable backend error.

export function Launch(): JSX.Element {
  const { actions } = useFleet();
  const navigate = useNavigate();

  const [repo, setRepo] = createSignal(SUGGESTED_REPOS[0] ?? "");
  const [scope, setScope] = createSignal("");
  const [model, setModel] = createSignal("");
  const [briefPath, setBriefPath] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");

  const canSubmit = () => repo().trim() !== "" && scope().trim() !== "" && !busy();

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy()) return;
    if (repo().trim() === "" || scope().trim() === "") {
      setError("Repo and scope are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const id = await actions.launch({
        repo: repo().trim(),
        scope: scope().trim(),
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
          <input
            list="launch-repos"
            value={repo()}
            placeholder="omnifield/brainer"
            onInput={(e) => setRepo(e.currentTarget.value)}
          />
          <datalist id="launch-repos">
            <For each={SUGGESTED_REPOS}>{(r) => <option value={r} />}</For>
          </datalist>
        </label>

        <label class="field">
          <span>
            Scope
            <Show when={scope().trim() !== ""}>
              <span class="field-hint"> ({roleForScope(scope())})</span>
            </Show>
          </span>
          <input
            list="launch-scopes"
            value={scope()}
            placeholder="frontend"
            onInput={(e) => setScope(e.currentTarget.value)}
          />
          <datalist id="launch-scopes">
            <For each={SUGGESTED_SCOPES}>
              {(sc) => <option value={sc}>{`${sc} (${roleForScope(sc)})`}</option>}
            </For>
          </datalist>
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
          <button type="submit" class="btn btn-primary" disabled={!canSubmit()}>
            {busy() ? "Spawning…" : "Spawn session"}
          </button>
        </div>
      </form>
    </>
  );
}
