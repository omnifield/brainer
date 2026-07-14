"""brainer bridge — agent as a live participant of a chater room (Step 1: one agent, one room).

A thin process that speaks chater's public v0 API as an ordinary client; chater stays unaware of
agents. Deliberately обособленный — folds into kernel/orchestrator later by `git mv`, not rewrite.
"""

from .config import Settings
from .loop import Bridge, run_bridge

__all__ = ["Settings", "Bridge", "run_bridge"]
