# 🎵 Music Downloader - For Navidrome and local downloads

A modern web application that allows users to search for songs on Spotify and automatically download them from YouTube, then seamlessly add them to your Navidrome music server. Perfect for building your personal music library with proper metadata, album art, and organized file structure.

## Features

- 🎵 Search for songs using Spotify's rich database
- 📥 Automatic download from YouTube using metadata
- 🏷️ Automatic ID3 tagging with artist, album, album art, and metadata
- 📂 Direct upload to Navidrome server
- 🎨 Modern, clean web interface
- ⚡ Real-time download status updates

## Architecture

- **Frontend**: Vanilla JavaScript, HTML, CSS
- **Backend**: Python FastAPI
- **Spotify API**: For searching and getting track metadata
- **yt-dlp**: For downloading audio from YouTube
- **mutagen**: For ID3 tagging
- **Navidrome**: Music server integration

## Prerequisites

- Python 3.8+
- FFmpeg (required by yt-dlp for audio conversion)
- Spotify API credentials ([Get them here](https://developer.spotify.com/dashboard))
- Navidrome server with access to its music library directory
- Node.js (optional, if you want to use a dev server for frontend)

## Installation

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd musicDownloader
```

### 2. Install Python dependencies

```bash
cd backend
pip install -r requirements.txt
```

Or use a virtual environment:

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Install FFmpeg

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install ffmpeg
```

**macOS:**
```bash
brew install ffmpeg
```

**Windows:**
Download from [FFmpeg website](https://ffmpeg.org/download.html) and add to PATH

### 4. Configure environment variables

Create a `.env` file in the `backend` directory:

```env
# Spotify API Configuration
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:8000/callback

# Navidrome Configuration
NAVIDROME_MUSIC_PATH=/path/to/navidrome/music
NAVIDROME_API_URL=http://localhost:4533
NAVIDROME_USERNAME=admin
NAVIDROME_PASSWORD=password

# Download Configuration
OUTPUT_FORMAT=mp3
AUDIO_QUALITY=192

# API Configuration
API_HOST=0.0.0.0
API_PORT=8000
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
```

### 5. Get Spotify API Credentials

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Copy the Client ID and Client Secret
4. Add `http://localhost:8000/callback` to Redirect URIs (optional for client credentials flow)

### 6. Configure Navidrome Path

Set `NAVIDROME_MUSIC_PATH` to the directory where Navidrome stores its music library. This path must be:
- Writable by the user running the backend
- Accessible (local filesystem, NFS mount, or similar)

## Running the Application

### Backend

```bash
cd backend
python app.py
```

Or with uvicorn directly:

```bash
cd backend
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

The application (both frontend and API) will be available at `http://localhost:8000`

The frontend is automatically served from the backend, so no separate frontend server is needed.

## Usage

1. Open the web interface in your browser
2. Search for a song, artist, or album
3. Browse the search results
4. Click "Download" on any track you want
5. Wait for the download and processing to complete
6. The song will be added to your Navidrome library automatically

## How It Works

1. **Search**: Uses Spotify API to search for tracks and get rich metadata
2. **Download**: Uses yt-dlp to search YouTube and download audio
3. **Tagging**: Applies ID3 tags using metadata from Spotify (title, artist, album, cover art)
4. **Upload**: Copies the file to Navidrome's music directory in organized folders (Artist/Album/)
5. **Scan**: Optionally triggers Navidrome to scan for new files (if API credentials are configured)

## API Endpoints

- `POST /api/search` - Search for tracks on Spotify
  - Body: `{ "query": "search term", "limit": 20 }`
  
- `GET /api/track/{track_id}` - Get details for a specific track

- `POST /api/download` - Start downloading a track
  - Body: `{ "track_id": "spotify_track_id" }`

- `GET /api/download/status/{track_id}` - Get download status

- `GET /api/health` - Health check endpoint

## Project Structure

```
musicDownloader/
├── backend/
│   ├── app.py                 # FastAPI main application
│   ├── config.py              # Configuration management
│   ├── requirements.txt       # Python dependencies
│   ├── services/
│   │   ├── spotify.py         # Spotify API integration
│   │   ├── youtube.py         # YouTube download with yt-dlp
│   │   ├── metadata.py        # ID3 tagging
│   │   └── navidrome.py       # Navidrome integration
│   └── utils/
│       └── file_handler.py    # File operations
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── README.md
```

## Troubleshooting

### Spotify API Errors

- Make sure your Client ID and Secret are correct
- Check that you've created an app in the Spotify Developer Dashboard

### YouTube Download Fails

- Ensure FFmpeg is installed and in your PATH
- Check your internet connection
- Some videos may be region-locked or unavailable

### Navidrome Upload Fails

- Verify `NAVIDROME_MUSIC_PATH` is correct and writable
- Check file permissions on the Navidrome music directory
- Ensure the path exists

### CORS Errors

- Update `CORS_ORIGINS` in `.env` to include your frontend URL
- Make sure the frontend is accessing the correct API URL

## Legal Considerations

- This tool is for personal use only
- Respect copyright laws in your jurisdiction
- Spotify API Terms of Service apply
- YouTube Terms of Service apply
- Use responsibly and ethically

## License

This project is provided as-is for educational and personal use.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Description

Music Downloader is a full-stack web application designed to streamline the process of adding music to your Navidrome server. By leveraging Spotify's comprehensive music database for search and metadata, and YouTube as the audio source, it provides a seamless way to discover and download music with proper ID3 tags, album artwork, and organized folder structure.

**Key Benefits:**
- 🚀 **Fast & Efficient**: Single-click downloads with automatic processing
- 📊 **Rich Metadata**: Complete ID3 tags from Spotify (artist, album, year, genre, artwork)
- 🗂️ **Auto-Organization**: Files automatically organized in Artist/Album/ structure
- 🔄 **Auto-Sync**: Automatically triggers Navidrome library scans
- 💻 **Self-Hosted**: Full control over your data and downloads
- 🎨 **Modern UI**: Clean, responsive web interface
- 📥 **Dual Download Options**: Choose between local downloads or direct Navidrome server upload

Perfect for music enthusiasts who want to expand their Navidrome library quickly and efficiently!

