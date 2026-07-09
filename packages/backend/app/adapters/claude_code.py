"""ClaudeCodeAdapter — the single MVP provider, over `claude-agent-sdk` (blueprint §1.4).

Headless: a `ClaudeSDKClient` holds a live session (no terminal). `query()` = follow-up into the
same context (`send`), `receive_messages()` = the continuous event stream, `interrupt()` = soft
stop, `disconnect()` = hard kill. SDK message/block types are mapped INTO contract events here and
never leak outward.

seq ownership: the contract's `stream()` yields fully-formed `Event`s (envelope carries `seq`), so
the adapter assigns `seq`. It is seeded from `provider_state["seq_base"]` and, on `resume`, the base
jumps by `SEQ_BLOCK` — one registry write per session epoch, monotonic across restart, no per-event
I/O. gaps between epochs are harmless for dedup (Last-Event-ID) and chater ordering.

Resume needs the SAME `cwd` + `CLAUDE_CONFIG_DIR` and the SDK session id, so `provider_state` carries
`{sdk_session_id, cwd, config_dir, seq_base}` plus the launch params (`scope/permission/model/persona`)
needed to rebuild identical options from the handle alone.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    CLIConnectionError,
    RateLimitEvent,
    ResultMessage,
    StreamEvent,
    SystemMessage,
    TextBlock,
    ThinkingBlock,
    ToolResultBlock,
    ToolUseBlock,
    UserMessage,
)
from omnifield_kernel import (
    AgentProvider,
    AgentSessionHandle,
    DoneEvent,
    DonePayload,
    ErrorEvent,
    ErrorPayload,
    Event,
    LaunchRequest,
    LimitEvent,
    LimitPayload,
    MessageEvent,
    MessagePayload,
    PermissionLevel,
    StatusEvent,
    StatusPayload,
    ThinkingEvent,
    ThinkingPayload,
    ToolCallEvent,
    ToolCallPayload,
    ToolResultEvent,
    ToolResultPayload,
    Usage,
)

from ..channel.seq import SEQ_BLOCK, next_epoch_base
from ..config import Settings
from ..lib.trace import span

__all__ = ["ClaudeCodeAdapter", "map_sdk_message", "SEQ_BLOCK"]  # SEQ_BLOCK re-exported for tests/back-compat

# Our permission vocabulary → SDK permission_mode (blueprint §1.4.3). `standard` leans on the git-gate
# hook (second line of defense) + tool-lists from presets (deferred); mode alone stays acceptEdits.
_PERMISSION_MODE: dict[PermissionLevel, str] = {
    "readonly": "plan",
    "standard": "acceptEdits",
    "trusted": "bypassPermissions",
}

# SDK RateLimitType values that mean an account/usage cap (vs a short-window rate cap).
_ACCOUNT_LIMIT_TYPES = frozenset({"five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet", "overage"})


# Transient transport failures worth a retry; everything else (missing CLI, decode/logic errors,
# non-SDK bugs) is reported non-retryable.
_RETRYABLE_ERRORS = (CLIConnectionError,)


def _retryable_exc(exc: BaseException) -> bool:
    return isinstance(exc, _RETRYABLE_ERRORS)


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def _iso_from_epoch(epoch: int | None) -> str | None:
    if epoch is None:
        return None
    # SDK carries epoch seconds; tolerate millis defensively.
    secs = epoch / 1000 if epoch > 1_000_000_000_000 else epoch
    return datetime.fromtimestamp(secs, tz=UTC).isoformat()


def _usage_from(msg: ResultMessage) -> Usage:
    u = msg.usage or {}
    return Usage(
        input_tokens=int(u.get("input_tokens", 0) or 0),
        output_tokens=int(u.get("output_tokens", 0) or 0),
        cost_usd=msg.total_cost_usd,
    )


def _done_reason(msg: ResultMessage) -> str:
    st = (msg.subtype or "").lower()
    if "max_turns" in st or msg.stop_reason == "max_turns":
        return "max-turns"
    if msg.stop_reason in ("interrupt", "stopped", "aborted"):
        return "stopped"
    if msg.is_error:
        return "error"
    return "completed"


@dataclass
class _LiveSession:
    """In-memory handle to a connected SDK client + this session's seq epoch."""

    client: ClaudeSDKClient | None
    cwd: str
    config_dir: str | None
    seq_base: int
    sdk_session_id: str | None = None
    _local: int = field(default=0, repr=False)
    # Merge lane: `stream()` drains this; `send()` injects the user's own reply here (the SDK stream
    # does not echo it). Items are ("sdk", msg) | ("inject_user", text) | ("error", exc) | ("closed", None).
    q: asyncio.Queue = field(default_factory=asyncio.Queue, repr=False)

    def next_seq(self) -> int:
        s = self.seq_base + self._local
        self._local += 1
        return s

    def capture_sid(self, sid: str | None) -> None:
        if sid and not self.sdk_session_id:
            self.sdk_session_id = sid


def map_sdk_message(msg: Any, live: _LiveSession, session_id: str) -> list[Event]:
    """Map ONE SDK message to zero+ contract events (blueprint §1.4). Pure — no client/network; the
    unit tests drive it with mock SDK objects. Also captures the SDK session id for resume."""

    def _env() -> dict[str, Any]:
        return {"session_id": session_id, "seq": live.next_seq(), "ts": _now_iso()}

    out: list[Event] = []

    if isinstance(msg, AssistantMessage):
        live.capture_sid(getattr(msg, "session_id", None))
        for block in msg.content:
            if isinstance(block, TextBlock):
                out.append(MessageEvent(**_env(), payload=MessagePayload(role="agent", text=block.text)))
            elif isinstance(block, ThinkingBlock):
                out.append(ThinkingEvent(**_env(), payload=ThinkingPayload(text=block.thinking)))
            elif isinstance(block, ToolUseBlock):
                out.append(
                    ToolCallEvent(
                        **_env(), payload=ToolCallPayload(call_id=block.id, tool=block.name, input=block.input)
                    )
                )

    elif isinstance(msg, UserMessage):
        content = msg.content
        if isinstance(content, list):
            for block in content:
                if isinstance(block, ToolResultBlock):
                    out.append(
                        ToolResultEvent(
                            **_env(),
                            payload=ToolResultPayload(
                                call_id=block.tool_use_id, output=block.content, is_error=bool(block.is_error)
                            ),
                        )
                    )

    elif isinstance(msg, SystemMessage):
        data = msg.data if isinstance(msg.data, dict) else {}
        live.capture_sid(data.get("session_id"))
        state = "starting" if msg.subtype == "init" else "running"
        out.append(StatusEvent(**_env(), payload=StatusPayload(state=state, detail=msg.subtype)))

    elif isinstance(msg, ResultMessage):
        live.capture_sid(msg.session_id)
        if msg.is_error:
            message = "; ".join(msg.errors or []) or msg.result or "turn ended with error"
            out.append(
                ErrorEvent(
                    **_env(),
                    payload=ErrorPayload(
                        code=str(msg.api_error_status) if msg.api_error_status else "turn_error",
                        message=message,
                        retryable=bool(msg.api_error_status and 500 <= msg.api_error_status < 600),
                    ),
                )
            )
        out.append(DoneEvent(**_env(), payload=DonePayload(reason=_done_reason(msg), usage=_usage_from(msg))))

    elif isinstance(msg, RateLimitEvent):
        info = msg.rate_limit_info
        if getattr(info, "status", None) == "rejected":
            scope = "account" if info.rate_limit_type in _ACCOUNT_LIMIT_TYPES else "rate"
            out.append(
                LimitEvent(**_env(), payload=LimitPayload(scope=scope, resets_at=_iso_from_epoch(info.resets_at)))
            )

    elif isinstance(msg, StreamEvent):
        # Partial token streaming — MVP keeps include_partial_messages=False, so these do not arrive;
        # the mapping (→ message{partial:true}) turns on with the flag, no contract change.
        pass

    return out


class ClaudeCodeAdapter(AgentProvider):
    """kernel `AgentProvider` over claude-agent-sdk. Holds live clients in-memory keyed by our id."""

    name = "claude-code"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._live: dict[str, _LiveSession] = {}

    # ---- options / env ----

    def _otel_env(self, scope: str, repo: str) -> dict[str, str]:
        # brainer/writer launchers carry no OTEL block; the backend injects it so telemetry (metrics)
        # flows on any spawned session (backend-mvp §Session control; claude-scope is the reference).
        return {
            "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
            "OTEL_METRICS_EXPORTER": "otlp",
            "OTEL_LOGS_EXPORTER": "otlp",
            "OTEL_EXPORTER_OTLP_PROTOCOL": "grpc",
            "OTEL_EXPORTER_OTLP_ENDPOINT": self._settings.otel_endpoint,
            "OTEL_RESOURCE_ATTRIBUTES": f"scope={scope},package={scope},repo={repo}",
        }

    def _build_options(
        self, *, scope: str, repo: str, cwd: str, config_dir: str | None,
        permission: PermissionLevel, model: str | None, persona: str | None, resume: str | None,
    ) -> ClaudeAgentOptions:
        env = dict(os.environ)
        env["OMNIFIELD_SCOPE"] = scope
        if config_dir:
            env["CLAUDE_CONFIG_DIR"] = config_dir
        env.update(self._otel_env(scope, repo))
        system_prompt: Any = None
        if persona:
            # Append the persona to Claude Code's default system prompt (blueprint §2.2), not replace it.
            system_prompt = {"type": "preset", "preset": "claude_code", "append": persona}
        return ClaudeAgentOptions(
            cwd=cwd,
            env=env,
            permission_mode=_PERMISSION_MODE[permission],
            system_prompt=system_prompt,
            model=model,
            resume=resume,
            include_partial_messages=False,
            # Load the repo's .claude settings/hooks (git-gate is the git-write second line of defense).
            setting_sources=["user", "project", "local"],
        )

    # ---- contract ----

    async def launch(self, request: LaunchRequest) -> AgentSessionHandle:
        with span("adapter.launch", role=request.role, repo=request.repo):
            repo = self._settings.repo(request.repo)
            if repo is None:
                raise ValueError(f"unknown repo: {request.repo}")
            scope = request.role  # pre-presets: role IS the zone identity that hooks/OTEL key on
            cwd = str(repo.path)
            config_dir = self._settings.claude_config_dir
            options = self._build_options(
                scope=scope, repo=request.repo, cwd=cwd, config_dir=config_dir,
                permission=request.permission, model=request.model, persona=request.persona, resume=None,
            )
            client = ClaudeSDKClient(options=options)
            await client.connect()
            if request.brief:
                await client.query(f"Прочитай бриф {request.brief} и приступай к работе.")

            session_id = f"{scope}-{os.urandom(4).hex()}"
            self._live[session_id] = _LiveSession(client=client, cwd=cwd, config_dir=config_dir, seq_base=0)
            return AgentSessionHandle(
                session_id=session_id,
                provider=self.name,
                provider_state={
                    "sdk_session_id": None,  # filled once the stream yields the first message
                    "cwd": cwd,
                    "config_dir": config_dir,
                    "seq_base": 0,
                    "scope": scope,
                    "repo": request.repo,
                    "permission": request.permission,
                    "model": request.model,
                    "persona": request.persona,
                },
            )

    async def send(self, handle: AgentSessionHandle, text: str) -> None:
        live = self._require_live(handle)
        with span("adapter.send", session_id=handle.session_id):
            # Ф2: the SDK stream never echoes the user's own prompt, so inject a wire
            # `message {role:user}` into the merge lane BEFORE the turn runs. Enqueuing before
            # query() guarantees it precedes the agent's response; seq is assigned at dequeue in
            # `stream()`, so FIFO order == seq order (user reply < response). The frontend reconciles
            # its optimistic echo against this, and replay after reconnect stays honest.
            live.q.put_nowait(("inject_user", text))
            try:
                await live.client.query(text)
            except Exception as exc:
                # The echo is already in the lane; a failed turn must not leave a "sent" reply with
                # no outcome — surface an error event too, then propagate (API returns the failure).
                live.q.put_nowait(("error", exc))
                raise

    async def _pump_sdk(self, live: _LiveSession) -> None:
        """Feed raw SDK messages into the merge lane so `stream()` interleaves them with injects."""
        try:
            async for msg in live.client.receive_messages():
                live.q.put_nowait(("sdk", msg))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # Any failure (SDK or otherwise) is surfaced as an error event — never a silent close
            # (that would regress the stream_crash visibility the hub used to provide).
            live.q.put_nowait(("error", exc))
        finally:
            live.q.put_nowait(("closed", None))

    async def stream(self, handle: AgentSessionHandle) -> AsyncIterator[Event]:
        live = self._require_live(handle)
        with span("adapter.stream", session_id=handle.session_id):
            pump = asyncio.create_task(self._pump_sdk(live))
            try:
                while True:
                    kind, payload = await live.q.get()
                    if kind == "sdk":
                        for event in map_sdk_message(payload, live, handle.session_id):
                            yield event
                    elif kind == "inject_user":
                        yield MessageEvent(
                            session_id=handle.session_id,
                            seq=live.next_seq(),
                            ts=_now_iso(),
                            payload=MessagePayload(role="user", text=payload),
                        )
                    elif kind == "error":
                        yield ErrorEvent(
                            session_id=handle.session_id,
                            seq=live.next_seq(),
                            ts=_now_iso(),
                            payload=ErrorPayload(
                                code=type(payload).__name__,
                                message=str(payload),
                                retryable=_retryable_exc(payload),
                            ),
                        )
                    else:  # "closed" — the SDK stream ended (disconnect / teardown)
                        break
            finally:
                pump.cancel()

    async def resume(self, handle: AgentSessionHandle) -> AgentSessionHandle:
        with span("adapter.resume", session_id=handle.session_id):
            ps = handle.provider_state
            sdk_session_id = ps.get("sdk_session_id")
            if not sdk_session_id:
                # Never streamed far enough to learn the SDK session id → transcript can't be found.
                raise ResumeError(f"session {handle.session_id} has no sdk_session_id; not resumable")
            cwd = ps.get("cwd") or str(self._settings_repo_cwd(handle))
            config_dir = ps.get("config_dir")
            new_base = next_epoch_base(int(ps.get("seq_base", 0)))
            options = self._build_options(
                scope=ps.get("scope", handle.session_id), repo=ps.get("repo", ""), cwd=cwd, config_dir=config_dir,
                permission=ps.get("permission", "standard"), model=ps.get("model"), persona=ps.get("persona"),
                resume=sdk_session_id,
            )
            client = ClaudeSDKClient(options=options)
            await client.connect()
            self._live[handle.session_id] = _LiveSession(
                client=client, cwd=cwd, config_dir=config_dir, seq_base=new_base, sdk_session_id=sdk_session_id
            )
            return handle.model_copy(update={"provider_state": {**ps, "seq_base": new_base}})

    async def stop(self, handle: AgentSessionHandle, force: bool = False) -> None:
        with span("adapter.stop", session_id=handle.session_id, force=force):
            live = self._live.get(handle.session_id)
            if live is None or live.client is None:
                return
            if force:
                await live.client.disconnect()
                self._live.pop(handle.session_id, None)
            else:
                # Soft: interrupt the current turn; the session stays connected for follow-ups.
                await live.client.interrupt()

    # ---- helpers ----

    def current_handle(self, handle: AgentSessionHandle) -> AgentSessionHandle:
        """Reflect live in-memory state (captured sdk_session_id) back into the handle so the caller
        can re-persist it once the SDK session id is known (needed for resume)."""
        live = self._live.get(handle.session_id)
        if live is None or not live.sdk_session_id:
            return handle
        new_state = {**handle.provider_state, "sdk_session_id": live.sdk_session_id}
        return handle.model_copy(update={"provider_state": new_state})

    def _require_live(self, handle: AgentSessionHandle) -> _LiveSession:
        live = self._live.get(handle.session_id)
        if live is None or live.client is None:
            raise NotLiveError(f"session {handle.session_id} is not live (launch/resume it first)")
        return live

    def _settings_repo_cwd(self, handle: AgentSessionHandle) -> str:
        repo = self._settings.repo(handle.provider_state.get("repo", ""))
        return str(repo.path) if repo else "."


class NotLiveError(RuntimeError):
    """A live-session op (send/stream) was called on a session with no connected client."""


class ResumeError(RuntimeError):
    """A persisted session could not be resumed (e.g. no SDK session id captured)."""
