"""Prometheus reader — per-scope Claude Code metrics.

Metric names (verified against the Agent Fleet dashboard): token usage, cost, active time,
session count — labelled by `scope`/`package`. We read instant sums scoped to a session's scope.
"""

from __future__ import annotations

from typing import Any, Optional

import httpx

from ..lib.trace import traced
from ..sessions.models import Metrics

_METRICS = {
    "tokens": "claude_code_token_usage_tokens_total",
    "cost_usd": "claude_code_cost_usage_USD_total",
    "active_time_s": "claude_code_active_time_seconds_total",
    "session_count": "claude_code_session_count_total",
}


def parse_scalar(payload: dict[str, Any]) -> Optional[float]:
    """First sample value from an instant-query vector, or None if empty/failed."""
    if payload.get("status") != "success":
        return None
    result = payload.get("data", {}).get("result", [])
    if not result:
        return None
    value = result[0].get("value")
    if not value or len(value) < 2:
        return None
    try:
        return float(value[1])
    except (TypeError, ValueError):
        return None


def parse_label(payload: dict[str, Any], label: str) -> Optional[str]:
    for series in payload.get("data", {}).get("result", []):
        val = series.get("metric", {}).get(label)
        if val:
            return val
    return None


class PrometheusClient:
    def __init__(self, base_url: str, client: httpx.AsyncClient):
        self._base = base_url.rstrip("/")
        self._c = client

    async def query(self, promql: str) -> dict[str, Any]:
        async def _do() -> dict[str, Any]:
            r = await self._c.get(f"{self._base}/api/v1/query", params={"query": promql})
            r.raise_for_status()
            return r.json()

        return await traced("prometheus.query", _do, q=promql)

    async def metrics_for(self, scope: str) -> Metrics:
        m = Metrics()
        for field, metric in _METRICS.items():
            payload = await self.query(f'sum({metric}{{scope="{scope}"}})')
            value = parse_scalar(payload)
            if value is not None:
                setattr(m, field, value)
        return m

    async def model_for(self, scope: str) -> Optional[str]:
        """Best-effort model label off the token metric, if the exporter carries one."""
        payload = await self.query(f'{_METRICS["tokens"]}{{scope="{scope}"}}')
        return parse_label(payload, "model")
