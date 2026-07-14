# bridge — agent = live participant of a chater room (Step 1)

Minimal мост: a runnable process that speaks **chater's public v0 API** as an ordinary client and
makes one agent a live participant of **one** room. chater stays unaware of agents — we do **not**
move chat into brainer. Scope is deliberately narrow (brief `briefs/bridge-step1.md`): one agent,
one room, one live loop. No пульт/UI, no kernel provider-contract, no presets, no multi-agent.

Обособленный by design — no dependency on `kernel`/`backend`; it only calls chater. Folds into
`kernel`/`orchestrator` later by `git mv`, not a rewrite.

## What it does

1. Reads env (`config.Settings`) — no tokens baked in.
2. `POST /chater/users {handle}` → ensures the agent participant exists (idempotent: **409 = already
   exists = ok**, not a crash, so the bridge survives restarts without touching chater).
3. Opens `GET /chater/rooms/{ROOM_ID}/ws` with `Authorization: Bearer <AGENT_HANDLE>` on the upgrade
   (the bridge is not a browser → header auth, not a query-token).
4. Per `{type:"message", …}` frame: **if its id is one we posted → ignore** (self-echo cut, else an
   infinite loop). Otherwise build a prompt from recent history + the message, run the agent,
   `POST /chater/rooms/{ROOM_ID}/messages {body}` exactly once, and remember that reply's id. Self is
   filtered by our own posted ids (not author_id) because a 409 returns no id — chater needs no change.
5. Reconnects the ws on drop; agent/network errors are logged and swallowed (one bad turn never
   kills the process).

## Agent runtime

Step 1 uses **`claude -p "<prompt>"` as a subprocess**, stdout = the reply — the minimal runnable
for a stateless prompt→reply per message. It rides the ambient claude-code OAuth
(`CLAUDE_CONFIG_DIR`, injected into the devbox); **no API key** (there is none). The richer
`claude-agent-sdk` path (live context, resume) is the generalization for when this folds into
kernel/orchestrator.

## Env

| Var | Default | Meaning |
|---|---|---|
| `CHATER_URL` | `http://chater:8020` | chater base URL on the docker network |
| `AGENT_HANDLE` | `claude` | ASCII participant handle (also the ws Bearer) |
| `ROOM_ID` | — (**required**) | target room |
| `AGENT_HISTORY_LIMIT` | `20` | recent messages handed to the agent as context |
| `AGENT_TIMEOUT_S` | `300` | hard cap on a single agent turn |

## Run (smoke)

From `brainer-devbox` (has `uv`, `claude`, network alias to `chater`):

```sh
cd packages/bridge
ROOM_ID=1 uv run python -m bridge
```

Then, live: in the browser, add `AGENT_HANDLE` to `ROOM_ID` and post a message → the bridge replies
in the same room and the reply arrives without a refresh. Its own messages do not re-trigger it.

## Test

```sh
cd packages/bridge
uv run ruff check .
uv run pytest -q
```

Loop logic is tested against a stubbed chater client + stubbed agent (self-echo filter, one message
→ one POST, empty/failed turns post nothing); config covers required `ROOM_ID` and ws-url derivation.
