# Quick Setup Guide

## 1. Install Dependencies

### Python & FFmpeg
```bash
# Ubuntu/Debian
sudo apt update
sudo apt install python3 python3-pip python3-venv ffmpeg

# macOS
brew install python3 ffmpeg

# Windows
# Download Python from python.org
# Download FFmpeg from ffmpeg.org and add to PATH
```

## 2. Setup Backend

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp env.example .env
# Edit .env with your credentials
```

## 3. (Optional) Spotify API Credentials

MusicBrainz is used by default and does not require any API key.
Only if you want to use Spotify instead (`METADATA_PROVIDER=spotify`):

1. Go to https://developer.spotify.com/dashboard
2. Log in with your Spotify account
3. Click "Create app"
4. Fill in app name and description
5. Copy Client ID and Client Secret to `.env` file

## 4. Configure Navidrome Path

Edit `backend/.env` and set:
```env
NAVIDROME_MUSIC_PATH=/path/to/your/navidrome/music/library
```

This is the directory where Navidrome stores its music files. Make sure:
- The path exists
- The user running the backend has write permissions
- If Navidrome is on a remote server, mount it locally (NFS, SMB, etc.)

## 5. Run the Application

### Option 1: Use the start script
```bash
./start.sh
```

### Option 2: Manual start

```bash
cd backend
source venv/bin/activate
python app.py
```

## 6. Access the Application

Open your browser and go to: http://localhost:8000

## Troubleshooting

### "FFmpeg not found"
- Make sure FFmpeg is installed: `ffmpeg -version`
- Add FFmpeg to your system PATH

### "Spotify credentials not configured"
- Check that `.env` file exists in `backend/` directory
- Verify `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` are set

### "Permission denied" when uploading to Navidrome
- Check file permissions on `NAVIDROME_MUSIC_PATH`
- Ensure the user running the backend can write to that directory

### CORS errors in browser
- Since frontend is served from the same origin, CORS shouldn't be an issue
- If accessing via ngrok or external URL, ensure CORS_ORIGINS includes your URL

