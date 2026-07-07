"""Dependency wiring — one place that assembles the object graph.

`build_deps` is injectable (tests pass a stub httpx client with a MockTransport, or a fake fleet)
so the app factory stays test-friendly. The shared httpx.AsyncClient is owned here and closed on
app shutdown.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import httpx

from .config import Settings
from .providers.claude_code import ClaudeCodeProvider
from .sessions.fleet import FleetService
from .sessions.registry import SessionRegistry
from .sessions.tasks import TaskStore
from .telemetry.loki import LokiClient
from .telemetry.prometheus import PrometheusClient
from .telemetry.service import TelemetryService


@dataclass
class Deps:
    settings: Settings
    registry: SessionRegistry
    tasks: TaskStore
    telemetry: TelemetryService
    provider: ClaudeCodeProvider
    fleet: FleetService
    http: httpx.AsyncClient


def build_deps(settings: Optional[Settings] = None, *, http: Optional[httpx.AsyncClient] = None) -> Deps:
    settings = settings or Settings()
    client = http or httpx.AsyncClient(timeout=5.0)
    loki = LokiClient(settings.loki_url, client)
    prometheus = PrometheusClient(settings.prometheus_url, client)
    telemetry = TelemetryService(loki, prometheus, discovery_lookback_s=settings.discovery_lookback_s)
    registry = SessionRegistry()
    tasks = TaskStore()
    provider = ClaudeCodeProvider(settings, telemetry)
    fleet = FleetService(settings, registry, provider, telemetry, tasks)
    return Deps(
        settings=settings,
        registry=registry,
        tasks=tasks,
        telemetry=telemetry,
        provider=provider,
        fleet=fleet,
        http=client,
    )
