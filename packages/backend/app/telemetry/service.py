"""TelemetryService — composes Loki (activity/status) + Prometheus (metrics) per scope.

Degrades gracefully: if the observability stack is down, reads return None/empty rather than
crashing the API (the stack is a prereq for live data, not for the server to boot).
"""

from __future__ import annotations

import time
from datetime import datetime

import httpx

from ..sessions.models import Activity, ActivityEvent, Metrics, SessionStatus
from .loki import LokiClient, parse_events_since, parse_latest_activity
from .prometheus import PrometheusClient

_NS = 1_000_000_000


def _now_ns() -> int:
    return time.time_ns()


def derive_status(*, alive: bool, activity: Activity | None, now: float, threshold_s: int) -> SessionStatus:
    """Pure status rule. Dead process → done; fresh telemetry → working; else idle.

    blocked/error are semantic states we don't infer in MVP (documented boundary) — a session
    that is alive but quiet reads as idle, not blocked.
    """
    if not alive:
        return "done"
    if activity is not None:
        try:
            age = now - datetime.fromisoformat(activity.at).timestamp()
        except ValueError:
            age = None
        if age is not None and age <= threshold_s:
            return "working"
    return "idle"


class TelemetryService:
    def __init__(self, loki: LokiClient, prometheus: PrometheusClient, *, discovery_lookback_s: int):
        self._loki = loki
        self._prom = prometheus
        self._lookback_s = discovery_lookback_s

    async def activity(self, scope: str, *, lookback_s: int | None = None) -> Activity | None:
        lookback = lookback_s or self._lookback_s
        end = _now_ns()
        start = end - lookback * _NS
        try:
            payload = await self._loki.query_range(f'{{scope="{scope}"}}', start, end)
        except httpx.HTTPError:
            return None
        return parse_latest_activity(payload)

    async def metrics(self, scope: str) -> Metrics | None:
        try:
            return await self._prom.metrics_for(scope)
        except httpx.HTTPError:
            return None

    async def model(self, scope: str) -> str | None:
        try:
            return await self._prom.model_for(scope)
        except httpx.HTTPError:
            return None

    async def discover_scopes(self) -> list[str]:
        """Scopes that have lit up recently — sessions we may not have spawned ourselves."""
        end = _now_ns()
        start = end - self._lookback_s * _NS
        try:
            return await self._loki.label_values("scope", start, end)
        except httpx.HTTPError:
            return []

    async def events_since(self, scope: str, since_ns: int) -> list[tuple[int, ActivityEvent]]:
        end = _now_ns()
        start = max(since_ns, end - self._lookback_s * _NS)
        try:
            payload = await self._loki.query_range(f'{{scope="{scope}"}}', start, end)
        except httpx.HTTPError:
            return []
        return parse_events_since(payload, scope, since_ns)
