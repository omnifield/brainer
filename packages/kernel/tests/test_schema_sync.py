"""Single-source guard: committed JSON Schema must equal what the Pydantic models generate.

This is the mechanism behind "Python-типы и схема не должны мочь разъехаться" (brief deliverable 2):
the models are the source, the schema is generated, and drift fails the build here.
"""

from __future__ import annotations

import json

import pytest

from omnifield_kernel.events import EVENT_TYPES
from omnifield_kernel.schema import (
    EVENTS_SCHEMA_PATH,
    HANDLE_SCHEMA_PATH,
    events_schema,
    handle_schema,
)

_REGEN_HINT = "run `uv run python -m omnifield_kernel.schema` to regenerate the committed schema"

_CASES = [
    (EVENTS_SCHEMA_PATH, events_schema),
    (HANDLE_SCHEMA_PATH, handle_schema),
]


@pytest.mark.parametrize("path, builder", _CASES, ids=lambda x: getattr(x, "name", ""))
def test_committed_schema_matches_models(path, builder):
    assert path.exists(), f"missing schema artifact {path}; {_REGEN_HINT}"
    committed = json.loads(path.read_text(encoding="utf-8"))
    assert committed == builder(), f"{path.name} is stale; {_REGEN_HINT}"


def test_events_schema_exposes_all_types():
    schema = events_schema()
    assert set(schema["discriminator"]["mapping"]) == set(EVENT_TYPES)
