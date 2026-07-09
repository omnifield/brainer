"""Dependency wiring — one place that assembles the object graph.

The graph is now: kernel `SessionStore` (persistent sqlite) → `ClaudeCodeAdapter` (headless SDK) →
`ChannelHub` (delivery). `build_deps` is injectable (tests pass a fake adapter/store) so the app
factory stays test-friendly. The task board keeps its own in-memory store, unrelated to the channel.
"""

from __future__ import annotations

from dataclasses import dataclass

from omnifield_kernel import SessionStore

from .adapters.claude_code import ClaudeCodeAdapter
from .channel import ChannelHub
from .config import Settings
from .sessions.tasks import TaskStore


@dataclass
class Deps:
    settings: Settings
    store: SessionStore
    adapter: ClaudeCodeAdapter
    hub: ChannelHub
    tasks: TaskStore


def build_deps(
    settings: Settings | None = None,
    *,
    store: SessionStore | None = None,
    adapter: ClaudeCodeAdapter | None = None,
) -> Deps:
    settings = settings or Settings()
    store = store if store is not None else SessionStore()  # kernel sqlite in brainer's data-dir
    adapter = adapter if adapter is not None else ClaudeCodeAdapter(settings)
    hub = ChannelHub(adapter, store, settings.channel_buffer_size)
    tasks = TaskStore()
    return Deps(settings=settings, store=store, adapter=adapter, hub=hub, tasks=tasks)
