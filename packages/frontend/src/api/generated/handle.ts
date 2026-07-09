// GENERATED — do not edit by hand.
// Source of truth: packages/kernel/schema/handle.schema.json (kernel owns the contract).
// Regenerate: pnpm --filter @omnifield/brainer-frontend gen:types

export type SessionId = string
export type Provider = string

/**
 * Persistable reference to a session (blueprint §1.3, В2).
 * 
 * `session_id` is OURS. `provider_state` is opaque adapter JSON (for claude-code:
 * sdk_session_id / cwd / config_dir) — the kernel never looks inside it.
 */
export interface AgentSessionHandle {
session_id: SessionId
provider: Provider
provider_state?: ProviderState
}
export interface ProviderState {
[k: string]: unknown
}
