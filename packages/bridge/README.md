# bridge — agent = live participant of chater rooms

Minimal мост: a runnable process that speaks **chater's public v0 API** as an ordinary client and
makes an agent a live participant of chater rooms. chater stays unaware of agents — we do **not**
move chat into brainer. No пульт/UI, no kernel provider-contract, no presets, no multi-agent.

Обособленный by design — no dependency on `kernel`/`backend`; it only calls chater. Folds into
`kernel`/`orchestrator` later by `git mv`, not a rewrite.

## Modes

* **Auto (default, Step 2)** — `ROOM_ID` unset. The bridge discovers **every room the agent is a
  participant of** (`GET /chater/rooms` polled every `ROOMS_POLL_S`) and runs one subscription per
  room concurrently. Add the bot to a new room → within ~`ROOMS_POLL_S` it joins and replies there;
  remove it → its subscription closes. Each room has its own self-echo state (no cross-room replies).
* **Single-room (Step 1 back-compat)** — set `ROOM_ID`. The bridge attaches to exactly that room.

chater does not push the room list over ws, so discovery is a poll — chater needs no change.

## What it does

1. Reads env (`config.Settings`) — no tokens baked in.
2. `POST /chater/users {handle}` → ensures the agent participant exists (idempotent: **409 = already
   exists = ok**, not a crash, so the bridge survives restarts without touching chater).
3. Per room, opens `GET /chater/rooms/{room}/ws` with `Authorization: Bearer <AGENT_HANDLE>` on the
   upgrade (the bridge is not a browser → header auth, not a query-token).
4. Per `{type:"message", …}` frame: **if its id is one we posted (in that room) → ignore** (self-echo
   cut, else an infinite loop). Otherwise build a prompt from recent history + the message, run the
   agent, `POST /chater/rooms/{room}/messages {body}` exactly once, and remember that reply's id. Self
   is filtered by our own posted ids (not author_id) because a 409 returns no id — chater needs no change.
5. Reconnects each ws on drop; a failed poll keeps existing subscriptions; agent/network errors are
   logged and swallowed (one bad turn, or one bad room, never kills the process).

## Agent runtime

**`claude -p "<prompt>"` as a subprocess**, stdout = the reply — the minimal runnable for a
stateless prompt→reply per message. It rides the ambient claude-code OAuth (`CLAUDE_CONFIG_DIR`,
injected into the devbox); **no API key** (there is none). The richer `claude-agent-sdk` path (live
context, resume) is the generalization for when this folds into kernel/orchestrator.

## Env

| Var | Default | Meaning |
|---|---|---|
| `CHATER_URL` | `http://chater:8020` | chater base URL on the docker network |
| `AGENT_HANDLE` | `claude` | ASCII participant handle (also the ws Bearer) |
| `ROOM_ID` | — (unset → auto mode) | pin to one room (Step-1 back-compat) |
| `ROOMS_POLL_S` | `10` | auto-mode room-discovery cadence (seconds) |
| `AGENT_HISTORY_LIMIT` | `20` | recent messages handed to the agent as context |
| `AGENT_TIMEOUT_S` | `300` | hard cap on a single agent turn |

## Run (smoke)

From `brainer-devbox` (has `uv`, `claude`, network alias to `chater`):

```sh
cd packages/bridge
uv run python -m bridge                 # auto mode — all the agent's rooms
ROOM_ID=1 uv run python -m bridge       # single-room mode
```

Then, live (auto mode): in the browser, add `AGENT_HANDLE` to any of your rooms and post a message →
within ~`ROOMS_POLL_S` the bridge joins and replies in that room, without a refresh. Works across
two+ rooms at once; its own messages do not re-trigger it and replies never cross rooms.

## Test

```sh
cd packages/bridge
uv run ruff check .
uv run pytest -q
```

Tested against a fake chater + stubbed agent: the per-room loop (self-echo filter, one message → one
POST, empty/failed turns post nothing), the supervisor (discovery→subscribe, removal→unsubscribe,
appears-between-polls, reply-to-same-room, per-room posted-id isolation, failed-poll resilience),
config (single vs auto mode, ws-url derivation), and the chater client on `httpx.MockTransport`.
