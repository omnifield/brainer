"""JSON Schema artifacts of the wire contract — the SINGLE source of types for consumers.

The Pydantic models (events.py / contract.py) are the source of truth; these schemas are GENERATED
from them, committed under `packages/kernel/schema/`, and guarded by `tests/test_schema_sync.py`
so Python types and the published schema cannot drift. The frontend generates TypeScript from the
committed files (blueprint deliverable 2, review Z3).

Regenerate after any contract change:  `uv run python -m omnifield_kernel.schema`
"""

from __future__ import annotations

import json
from pathlib import Path

from .contract import AgentSessionHandle
from .events import event_adapter

_DRAFT = "https://json-schema.org/draft/2020-12/schema"

# schema.py -> omnifield_kernel -> src -> <package root>; artifacts live in <package root>/schema.
SCHEMA_DIR = Path(__file__).resolve().parents[2] / "schema"
EVENTS_SCHEMA_PATH = SCHEMA_DIR / "events.schema.json"
HANDLE_SCHEMA_PATH = SCHEMA_DIR / "handle.schema.json"


def events_schema() -> dict:
    """Discriminated-union schema of the 9 event types (oneOf + `type` discriminator)."""
    body = event_adapter.json_schema(ref_template="#/$defs/{model}")
    return {"$schema": _DRAFT, "title": "AgentSessionEvent", **body}


def handle_schema() -> dict:
    body = AgentSessionHandle.model_json_schema()
    return {"$schema": _DRAFT, **body}


_ARTIFACTS = {
    EVENTS_SCHEMA_PATH: events_schema,
    HANDLE_SCHEMA_PATH: handle_schema,
}


def write_schemas() -> list[Path]:
    """Write all schema artifacts to disk; returns the paths written."""
    SCHEMA_DIR.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for path, builder in _ARTIFACTS.items():
        path.write_text(json.dumps(builder(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        written.append(path)
    return written


if __name__ == "__main__":
    for path in write_schemas():
        print(f"wrote {path}")
