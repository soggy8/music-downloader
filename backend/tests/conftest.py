"""
Test isolation: set env before any `import config` / `import app`.

pytest_configure runs before test collection, so test modules that import `app`
see these values. dotenv does not override existing environment variables.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path


def pytest_configure(config) -> None:
    root = Path(tempfile.mkdtemp(prefix="musikat_pytest_"))
    (root / "downloads").mkdir(parents=True, exist_ok=True)
    (root / "navidrome").mkdir(parents=True, exist_ok=True)
    os.environ["DOWNLOAD_DIR"] = str(root / "downloads")
    os.environ["NAVIDROME_MUSIC_PATH"] = str(root / "navidrome")
    os.environ["NAVIDROME_SYNC_ENABLED"] = "false"
