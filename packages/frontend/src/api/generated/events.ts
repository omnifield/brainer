// GENERATED — do not edit by hand.
// Source of truth: packages/kernel/schema/events.schema.json (kernel owns the contract).
// Regenerate: pnpm --filter @omnifield/brainer-frontend gen:types

export type AgentSessionEvent = (MessageEvent | ThinkingEvent | ToolCallEvent | ToolResultEvent | StatusEvent | DoneEvent | ErrorEvent | LimitEvent | PermissionRequestEvent)
export type SessionId = string
export type Seq = number
export type Ts = string
export type Type = "message"
export type Role = ("agent" | "user")
export type Text = string
export type Partial = (boolean | null)
export type SessionId1 = string
export type Seq1 = number
export type Ts1 = string
export type Type1 = "thinking"
export type Text1 = string
export type SessionId2 = string
export type Seq2 = number
export type Ts2 = string
export type Type2 = "tool-call"
export type CallId = string
export type Tool = string
export type SessionId3 = string
export type Seq3 = number
export type Ts3 = string
export type Type3 = "tool-result"
export type CallId1 = string
export type IsError = boolean
export type SessionId4 = string
export type Seq4 = number
export type Ts4 = string
export type Type4 = "status"
export type State = ("starting" | "running" | "waiting" | "stopped")
export type Detail = (string | null)
export type SessionId5 = string
export type Seq5 = number
export type Ts5 = string
export type Type5 = "done"
export type Reason = ("completed" | "max-turns" | "stopped" | "error")
export type InputTokens = number
export type OutputTokens = number
export type CostUsd = (number | null)
export type SessionId6 = string
export type Seq6 = number
export type Ts6 = string
export type Type6 = "error"
export type Code = string
export type Message = string
export type Retryable = boolean
export type SessionId7 = string
export type Seq7 = number
export type Ts7 = string
export type Type7 = "limit"
export type Scope = ("account" | "rate")
export type ResetsAt = (string | null)
export type SessionId8 = string
export type Seq8 = number
export type Ts8 = string
export type Type8 = "permission-request"
export type RequestId = string
export type Tool1 = string

export interface MessageEvent {
session_id: SessionId
seq: Seq
ts: Ts
type?: Type
payload: MessagePayload
}
export interface MessagePayload {
role: Role
text: Text
partial?: Partial
}
export interface ThinkingEvent {
session_id: SessionId1
seq: Seq1
ts: Ts1
type?: Type1
payload: ThinkingPayload
}
export interface ThinkingPayload {
text: Text1
}
export interface ToolCallEvent {
session_id: SessionId2
seq: Seq2
ts: Ts2
type?: Type2
payload: ToolCallPayload
}
export interface ToolCallPayload {
call_id: CallId
tool: Tool
input: Input
}
export interface Input {
[k: string]: unknown
}
export interface ToolResultEvent {
session_id: SessionId3
seq: Seq3
ts: Ts3
type?: Type3
payload: ToolResultPayload
}
export interface ToolResultPayload {
call_id: CallId1
output: Output
is_error: IsError
}
export interface Output {
[k: string]: unknown
}
export interface StatusEvent {
session_id: SessionId4
seq: Seq4
ts: Ts4
type?: Type4
payload: StatusPayload
}
export interface StatusPayload {
state: State
detail?: Detail
}
export interface DoneEvent {
session_id: SessionId5
seq: Seq5
ts: Ts5
type?: Type5
payload: DonePayload
}
export interface DonePayload {
reason: Reason
usage: Usage
}
export interface Usage {
input_tokens: InputTokens
output_tokens: OutputTokens
cost_usd?: CostUsd
}
export interface ErrorEvent {
session_id: SessionId6
seq: Seq6
ts: Ts6
type?: Type6
payload: ErrorPayload
}
export interface ErrorPayload {
code: Code
message: Message
retryable: Retryable
}
export interface LimitEvent {
session_id: SessionId7
seq: Seq7
ts: Ts7
type?: Type7
payload: LimitPayload
}
export interface LimitPayload {
scope: Scope
resets_at?: ResetsAt
}
export interface PermissionRequestEvent {
session_id: SessionId8
seq: Seq8
ts: Ts8
type?: Type8
payload: PermissionRequestPayload
}
export interface PermissionRequestPayload {
request_id: RequestId
tool: Tool1
input: Input1
}
export interface Input1 {
[k: string]: unknown
}
