"""Loki reader — session activity/status from the OTEL log stream.

claude-scope ships Claude Code events (prompts, tool decisions, api requests) as OTEL logs into
the collector → Loki, tagged with the `scope` resource attribute we inject at spawn. We query
`{scope="<scope>"}` over a window; the newest line becomes `lastActivity`.

Parsing note (honest MVP boundary): the exact per-line shape depends on the collector's log
pipeline. `parse_*` handle both a JSON log record and a plain body line, and prefer a `tool_name`
attribute for the `tool` field. Field names may need tuning once real Loki data is inspected —
the parsers are pure and unit-tested so that tuning is local.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import httpx

from ..lib.trace import traced
from ..sessions.models import Activity, ActivityEvent

_QUERY_RANGE = "/loki/api/v1/query_range"


def ns_to_iso(ns: str | int) -> str:
    return datetime.fromtimestamp(int(ns) / 1_000_000_000, tz=UTC).isoformat()


def _activity_from(line: str, labels: dict[str, str]) -> tuple[str, str]:
    """(tool, summary) from one log line + its stream labels. Best-effort, pure."""
    record: dict[str, Any] | None = None
    try:
        parsed = json.loads(line)
        if isinstance(parsed, dict):
            record = parsed
    except (ValueError, TypeError):
        record = None

    if record is not None:
        tool = (
            record.get("tool_name")
            or record.get("event.name")
            or record.get("event_name")
            or labels.get("event_name")
            or "event"
        )
        summary = (
            record.get("body")
            or record.get("message")
            or record.get("prompt")
            or record.get("decision")
            or str(tool)
        )
        return str(tool), str(summary)

    tool = labels.get("event_name") or "event"
    return tool, line


def parse_latest_activity(payload: dict[str, Any]) -> Activity | None:
    """Newest activity across all streams in a query_range response, or None."""
    best: tuple[int, str, dict[str, str]] | None = None
    for stream in payload.get("data", {}).get("result", []):
        labels = stream.get("stream", {})
        for ns, line in stream.get("values", []):
            ts = int(ns)
            if best is None or ts > best[0]:
                best = (ts, line, labels)
    if best is None:
        return None
    ts, line, labels = best
    tool, summary = _activity_from(line, labels)
    return Activity(tool=tool, at=ns_to_iso(ts), summary=summary)


def parse_events_since(payload: dict[str, Any], scope: str, since_ns: int) -> list[tuple[int, ActivityEvent]]:
    """All events strictly newer than `since_ns`, ascending by timestamp (for /stream)."""
    out: list[tuple[int, ActivityEvent]] = []
    for stream in payload.get("data", {}).get("result", []):
        labels = stream.get("stream", {})
        for ns, line in stream.get("values", []):
            ts = int(ns)
            if ts <= since_ns:
                continue
            tool, summary = _activity_from(line, labels)
            out.append(
                (ts, ActivityEvent(session_id="", kind="tool", tool=tool, summary=summary, at=ns_to_iso(ts)))
            )
    out.sort(key=lambda t: t[0])
    return out


def parse_label_values(payload: dict[str, Any]) -> list[str]:
    return list(payload.get("data", []))


class LokiClient:
    def __init__(self, base_url: str, client: httpx.AsyncClient):
        self._base = base_url.rstrip("/")
        self._c = client

    async def query_range(self, query: str, start_ns: int, end_ns: int, limit: int = 200) -> dict[str, Any]:
        async def _do() -> dict[str, Any]:
            r = await self._c.get(
                f"{self._base}{_QUERY_RANGE}",
                params={
                    "query": query,
                    "start": str(start_ns),
                    "end": str(end_ns),
                    "limit": str(limit),
                    "direction": "backward",
                },
            )
            r.raise_for_status()
            return r.json()

        return await traced("loki.query_range", _do, query=query)

    async def label_values(self, label: str, start_ns: int, end_ns: int) -> list[str]:
        async def _do() -> list[str]:
            r = await self._c.get(
                f"{self._base}/loki/api/v1/label/{label}/values",
                params={"start": str(start_ns), "end": str(end_ns)},
            )
            r.raise_for_status()
            return parse_label_values(r.json())

        return await traced("loki.label_values", _do, label=label)
