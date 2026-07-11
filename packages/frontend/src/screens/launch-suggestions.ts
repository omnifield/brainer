// Launch autocomplete suggestions — hints ONLY, not the source of truth for what
// is manageable. Any repo/scope can be typed by hand (the backend registry decides
// what actually resolves; an unknown repo comes back as a readable `404 unknown repo`).
//
// TODO(backend-registry): source these suggestions from the backend repo/scope
// registry (a future endpoint, env-first — see briefs/fix-backend-repo-registry.md)
// instead of hardcoded constants. Product backlog owned by architect. Until then the
// list is a best-effort convenience and may lag reality.

export const SUGGESTED_REPOS = [
  "omnifield/brainer",
  "omnifield/writer",
  "omnifield/commons",
  "omnifield/weber",
  "omnifield/chater",
];

// Scopes are per-repo (weber/chater do NOT share brainer's kernel/backend/… zones),
// so no fixed list is ever correct — these are brainer's zones as a starting hint only.
export const SUGGESTED_SCOPES = [
  "main",
  "kernel",
  "orchestrator",
  "backend",
  "frontend",
  "content",
];

// Role for a scope, mirroring the backend's `role_for_scope`: `main` → architect,
// anything else → owner. Holds for ANY typed value, not just the suggestions above.
export function roleForScope(scope: string): "architect" | "owner" {
  return scope.trim() === "main" ? "architect" : "owner";
}
