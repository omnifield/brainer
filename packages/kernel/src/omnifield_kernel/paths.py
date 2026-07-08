"""Where the session registry lives — brainer's data-dir, NEVER inside a managed repo.

The handle store must survive process restarts and stay out of any repo under management (blueprint
§1.3). Override with `BRAINER_DATA_DIR`; otherwise a per-user location outside the source tree.
"""

from __future__ import annotations

import os
from pathlib import Path


def default_data_dir() -> Path:
    override = os.environ.get("BRAINER_DATA_DIR")
    if override:
        return Path(override)
    local = os.environ.get("LOCALAPPDATA")  # Windows-native brainer host
    if local:
        return Path(local) / "omnifield" / "brainer"
    return Path.home() / ".omnifield" / "brainer"


def default_db_path() -> Path:
    return default_data_dir() / "sessions.db"
