"""Perf-logger tracing — the DoD "трейсы" on hot paths (spawn, telemetry-poll).

Mirrors the frontend `lib/trace.ts` intent: wrap a unit of work, emit its duration under a
stable span name. Deliberately tiny (stdlib logging + perf_counter) — instrumentation, not a
framework. Both sync and async call sites are covered.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager, contextmanager
from functools import wraps
from typing import TypeVar

logger = logging.getLogger("brainer.trace")

T = TypeVar("T")


@contextmanager
def span(name: str, **fields: object):
    start = time.perf_counter()
    ok = True
    try:
        yield
    except Exception:
        ok = False
        raise
    finally:
        _emit(name, start, ok, fields)


@asynccontextmanager
async def aspan(name: str, **fields: object):
    start = time.perf_counter()
    ok = True
    try:
        yield
    except Exception:
        ok = False
        raise
    finally:
        _emit(name, start, ok, fields)


async def traced[T](name: str, fn: Callable[[], Awaitable[T]], **fields: object) -> T:
    """Trace a single async thunk — `await traced("loki.query", lambda: client.get(...))`."""
    async with aspan(name, **fields):
        return await fn()


def traced_fn(name: str):
    """Decorator variant for sync functions on hot paths."""

    def deco(fn: Callable[..., T]) -> Callable[..., T]:
        @wraps(fn)
        def wrapper(*args: object, **kwargs: object) -> T:
            with span(name):
                return fn(*args, **kwargs)

        return wrapper

    return deco


def _emit(name: str, start: float, ok: bool, fields: dict[str, object]) -> None:
    dur_ms = (time.perf_counter() - start) * 1000
    extra = "".join(f" {k}={v}" for k, v in fields.items())
    logger.info("span=%s ok=%s dur_ms=%.1f%s", name, ok, dur_ms, extra)
