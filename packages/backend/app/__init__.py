"""Brainer backend — product API/BFF over the agent-as-provider seam.

Serves the contract fixed by `briefs/interface-mvp.md` §Контракт (the same shape the
frontend already codes against a mock adapter) backed by real data: the ClaudeCodeProvider
spawns claude-scope sessions, and telemetry is read from the existing OTEL substrate
(Loki for activity/status, Prometheus for metrics).
"""
