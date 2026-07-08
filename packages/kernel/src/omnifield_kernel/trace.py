"""Perf-logger tracing — the DoD "трейсы" on the registry hot paths.

Self-contained (stdlib logging + perf_counter) so the kernel keeps zero non-pydantic deps. Mirrors
the intent of backend `app/lib/trace.py` but the kernel does not import backend (boundary). Tiny by
design: instrumentation, not a framework.
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager

logger = logging.getLogger("omnifield.kernel.trace")


@contextmanager
def span(name: str, **fields: object):
    """Wrap a unit of work; emit its duration under a stable span name."""
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
