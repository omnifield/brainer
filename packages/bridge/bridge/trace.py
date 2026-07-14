"""Tiny perf-logger — the DoD "трейсы" on the bridge hot paths (chater I/O, agent turns).

Same intent as backend `lib/trace.py`: wrap a unit of work, emit its duration under a stable span
name. Self-contained (stdlib only) so the bridge stays обособленным until it folds into
kernel/orchestrator.
"""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

logger = logging.getLogger("brainer.bridge.trace")


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
        dur_ms = (time.perf_counter() - start) * 1000
        extra = "".join(f" {k}={v}" for k, v in fields.items())
        logger.info("span=%s ok=%s dur_ms=%.1f%s", name, ok, dur_ms, extra)
