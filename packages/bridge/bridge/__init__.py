"""brainer bridge — agent as a live participant of chater rooms.

A thin process that speaks chater's public v0 API as an ordinary client; chater stays unaware of
agents. Step 1: one agent, one room. Step 2: auto-discover every room the agent belongs to and join
new ones as they appear. Deliberately обособленный — folds into kernel/orchestrator later by
`git mv`, not rewrite.
"""

from .config import Settings
from .loop import Bridge, RoomSupervisor, run_bridge

__all__ = ["Settings", "Bridge", "RoomSupervisor", "run_bridge"]
