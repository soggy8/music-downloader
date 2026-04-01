import os
import re
from pathlib import Path
from typing import List, Dict, Any
from dotenv import load_dotenv

load_dotenv()

# Metadata provider: "deezer" (default, no API key) or "spotify" (requires credentials)
_raw_provider = os.getenv("DEFAULT_METADATA_PROVIDER", "deezer").lower().strip()
DEFAULT_METADATA_PROVIDER = _raw_provider if _raw_provider in ("deezer", "spotify") else "deezer"

# Spotify API (optional — only needed when using provider "spotify")
SPOTIFY_CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET", "")
SPOTIFY_REDIRECT_URI = os.getenv("SPOTIFY_REDIRECT_URI", "http://localhost:8000/callback")

# Navidrome Configuration
# Multiple libraries: set NAVIDROME_MUSIC_PATHS to a comma- or newline-separated list of absolute paths.
# Optional NAVIDROME_MUSIC_LABELS: same order, comma/newline-separated labels (defaults to folder basename).
# If NAVIDROME_MUSIC_PATHS is unset, NAVIDROME_MUSIC_PATH (single path, default /music) is used.
def _parse_navidrome_paths() -> List[str]:
    raw = (os.getenv("NAVIDROME_MUSIC_PATHS") or "").strip()
    paths: List[str] = []
    if raw:
        for part in re.split(r"[\n,]", raw):
            p = part.strip()
            if not p:
                continue
            paths.append(os.path.abspath(os.path.expanduser(p)))
    if not paths:
        single = (os.getenv("NAVIDROME_MUSIC_PATH") or "/music").strip()
        paths.append(os.path.abspath(os.path.expanduser(single)))
    # Deduplicate while preserving order
    seen = set()
    out: List[str] = []
    for p in paths:
        np = os.path.normpath(p)
        if np not in seen:
            seen.add(np)
            out.append(p)
    return out


def _parse_navidrome_labels() -> List[str]:
    raw = (os.getenv("NAVIDROME_MUSIC_LABELS") or "").strip()
    if not raw:
        return []
    return [x.strip() for x in re.split(r"[\n,]", raw) if x.strip()]


NAVIDROME_MUSIC_PATHS_LIST = _parse_navidrome_paths()
NAVIDROME_MUSIC_PATH = NAVIDROME_MUSIC_PATHS_LIST[0]
_label_parts = _parse_navidrome_labels()


def navidrome_libraries_public() -> List[Dict[str, Any]]:
    """Configured Navidrome music roots for API/UI (path + short label)."""
    libs = []
    for i, path in enumerate(NAVIDROME_MUSIC_PATHS_LIST):
        if i < len(_label_parts):
            label = _label_parts[i]
        else:
            label = os.path.basename(path.rstrip(os.sep)) or path
        libs.append({"path": path, "label": label})
    return libs


NAVIDROME_API_URL = os.getenv("NAVIDROME_API_URL", "http://localhost:4533")
NAVIDROME_USERNAME = os.getenv("NAVIDROME_USERNAME", "")
NAVIDROME_PASSWORD = os.getenv("NAVIDROME_PASSWORD", "")
# Scan music folder periodically and match files to Deezer/Spotify — mark completed_track_downloads
_nav_sync = os.getenv("NAVIDROME_SYNC_ENABLED", "true").lower().strip()
NAVIDROME_SYNC_ENABLED = _nav_sync in ("1", "true", "yes", "on")
NAVIDROME_SYNC_INTERVAL_HOURS = float(os.getenv("NAVIDROME_SYNC_INTERVAL_HOURS", "4"))
NAVIDROME_SYNC_INITIAL_DELAY_SEC = int(os.getenv("NAVIDROME_SYNC_INITIAL_DELAY_SEC", "120"))
NAVIDROME_SYNC_API_DELAY_SEC = float(os.getenv("NAVIDROME_SYNC_API_DELAY_SEC", "0.12"))

# Download Configuration
DOWNLOAD_DIR = os.getenv("DOWNLOAD_DIR", "./downloads")  # Temporary download location for testing
OUTPUT_FORMAT = os.getenv("OUTPUT_FORMAT", "mp3")
AUDIO_QUALITY = os.getenv("AUDIO_QUALITY", "128")  # kbps (lower = smaller files, 128 is good balance)
# Seconds to keep browser temp files after first serve (stray duplicate GETs then get 200 instead of 404)
TEMP_FILE_CLEANUP_DELAY_SEC = int(os.getenv("TEMP_FILE_CLEANUP_DELAY_SEC", "60"))

# YouTube Configuration
YOUTUBE_COOKIES_PATH = os.getenv("YOUTUBE_COOKIES_PATH", "")  # Path to YouTube cookies file (Netscape format) for yt-dlp

# API Configuration
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8000"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")

# Create directories if they don't exist
Path(DOWNLOAD_DIR).mkdir(parents=True, exist_ok=True)
for _nav_root in NAVIDROME_MUSIC_PATHS_LIST:
    Path(_nav_root).mkdir(parents=True, exist_ok=True)

