import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Spotify API Configuration
SPOTIFY_CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET", "")
SPOTIFY_REDIRECT_URI = os.getenv("SPOTIFY_REDIRECT_URI", "http://localhost:8000/callback")

# Navidrome Configuration
NAVIDROME_MUSIC_PATH = os.getenv("NAVIDROME_MUSIC_PATH", "/music")
NAVIDROME_API_URL = os.getenv("NAVIDROME_API_URL", "http://localhost:4533")
NAVIDROME_USERNAME = os.getenv("NAVIDROME_USERNAME", "")
NAVIDROME_PASSWORD = os.getenv("NAVIDROME_PASSWORD", "")

# Download Configuration
DOWNLOAD_DIR = os.getenv("DOWNLOAD_DIR", "./downloads")  # Temporary download location for testing
# If OUTPUT_FORMAT is not set, we default to "best" (no re-encode; keep original container/codec)
OUTPUT_FORMAT = os.getenv("OUTPUT_FORMAT", "best")
# If AUDIO_QUALITY is not set (or empty), default to "bestaudio" meaning “use best available input quality”.
# If re-encoding is enabled via OUTPUT_FORMAT, this should be a bitrate like "128", "192", "320".
AUDIO_QUALITY = os.getenv("AUDIO_QUALITY", "").strip() or "bestaudio"

# API Configuration
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8000"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")

# Create directories if they don't exist
Path(DOWNLOAD_DIR).mkdir(parents=True, exist_ok=True)
Path(NAVIDROME_MUSIC_PATH).mkdir(parents=True, exist_ok=True)

