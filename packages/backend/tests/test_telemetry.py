"""Telemetry parsing + status derivation — pure units, plus client I/O over a MockTransport."""

from __future__ import annotations

import time
from datetime import datetime, timezone

import httpx
import pytest

from app.sessions.models import Activity
from app.telemetry.loki import (
    LokiClient,
    parse_events_since,
    parse_label_values,
    parse_latest_activity,
)
from app.telemetry.prometheus import PrometheusClient, parse_label, parse_scalar
from app.telemetry.service import TelemetryService, derive_status


def _iso(seconds_ago: float) -> str:
    return datetime.fromtimestamp(time.time() - seconds_ago, tz=timezone.utc).isoformat()


def _ns(seconds_ago: float) -> str:
    return str(int((time.time() - seconds_ago) * 1_000_000_000))


# ---- Loki parsers ----


def test_parse_latest_activity_picks_newest_and_prefers_tool_name():
    payload = {
        "data": {
            "result": [
                {
                    "stream": {"scope": "backend"},
                    "values": [
                        [_ns(30), '{"tool_name": "Bash", "body": "running vitest"}'],
                        [_ns(90), '{"event.name": "user_prompt", "body": "start"}'],
                    ],
                }
            ]
        }
    }
    activity = parse_latest_activity(payload)
    assert activity is not None
    assert activity.tool == "Bash"
    assert activity.summary == "running vitest"


def test_parse_latest_activity_plain_line_falls_back_to_label():
    payload = {
        "data": {
            "result": [
                {"stream": {"event_name": "tool_result"}, "values": [[_ns(5), "wrote 3 files"]]}
            ]
        }
    }
    activity = parse_latest_activity(payload)
    assert activity is not None
    assert activity.tool == "tool_result"
    assert activity.summary == "wrote 3 files"


def test_parse_latest_activity_empty_is_none():
    assert parse_latest_activity({"data": {"result": []}}) is None


def test_parse_events_since_filters_and_sorts():
    payload = {
        "data": {
            "result": [
                {
                    "stream": {},
                    "values": [
                        ["100", '{"tool_name": "Edit"}'],
                        ["300", '{"tool_name": "Write"}'],
                        ["200", '{"tool_name": "Read"}'],
                    ],
                }
            ]
        }
    }
    events = parse_events_since(payload, "backend", since_ns=150)
    assert [ns for ns, _ in events] == [200, 300]
    assert [e.tool for _, e in events] == ["Read", "Write"]


def test_parse_label_values():
    assert parse_label_values({"data": ["backend", "frontend"]}) == ["backend", "frontend"]


# ---- Prometheus parsers ----


def test_parse_scalar_reads_first_sample():
    payload = {"status": "success", "data": {"result": [{"metric": {}, "value": [1710000000, "1234.5"]}]}}
    assert parse_scalar(payload) == 1234.5


def test_parse_scalar_empty_or_failed_is_none():
    assert parse_scalar({"status": "success", "data": {"result": []}}) is None
    assert parse_scalar({"status": "error"}) is None


def test_parse_label_reads_metric_label():
    payload = {"data": {"result": [{"metric": {"model": "claude-opus-4-8"}, "value": [0, "1"]}]}}
    assert parse_label(payload, "model") == "claude-opus-4-8"


# ---- status derivation ----


def test_derive_status_dead_is_done():
    assert derive_status(alive=False, activity=None, now=time.time(), threshold_s=60) == "done"


def test_derive_status_fresh_is_working():
    act = Activity(tool="Edit", at=_iso(5), summary="x")
    assert derive_status(alive=True, activity=act, now=time.time(), threshold_s=60) == "working"


def test_derive_status_stale_is_idle():
    act = Activity(tool="Edit", at=_iso(500), summary="x")
    assert derive_status(alive=True, activity=act, now=time.time(), threshold_s=60) == "idle"


def test_derive_status_no_activity_is_idle():
    assert derive_status(alive=True, activity=None, now=time.time(), threshold_s=60) == "idle"


# ---- clients over MockTransport ----


def _mock_client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_loki_client_query_range_roundtrip():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/loki/api/v1/query_range"
        assert request.url.params["query"] == '{scope="backend"}'
        return httpx.Response(
            200,
            json={"data": {"result": [{"stream": {}, "values": [[_ns(1), '{"tool_name": "Grep"}']]}]}},
        )

    async with _mock_client(handler) as client:
        loki = LokiClient("http://loki:3100", client)
        payload = await loki.query_range('{scope="backend"}', 0, 1)
        assert parse_latest_activity(payload).tool == "Grep"


async def test_prometheus_metrics_for_sums_each_metric():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "success", "data": {"result": [{"metric": {}, "value": [0, "10"]}]}})

    async with _mock_client(handler) as client:
        prom = PrometheusClient("http://prom:9090", client)
        metrics = await prom.metrics_for("backend")
        assert metrics.tokens == 10.0
        assert metrics.cost_usd == 10.0


async def test_service_degrades_when_stack_down():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    async with _mock_client(handler) as client:
        svc = TelemetryService(
            LokiClient("http://loki:3100", client),
            PrometheusClient("http://prom:9090", client),
            discovery_lookback_s=900,
        )
        assert await svc.activity("backend") is None
        assert await svc.metrics("backend") is None
        assert await svc.discover_scopes() == []
