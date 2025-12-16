# Docker Deployment Guide

**Just clone the repo and run it!** The Dockerfile automatically uses your local files - no GitHub downloads needed.

## Prerequisites

- Docker and Docker Compose installed
- Spotify API credentials (get from https://developer.spotify.com/dashboard)
- (Optional) Navidrome server

## Quick Start (3 Steps!)

1. **Clone and setup**
   ```bash
   git clone https://github.com/soggy8/music-downloader.git
   cd music-downloader
   cp backend/env.example backend/.env
   ```

2. **Edit `backend/.env`** - Add your Spotify credentials:
   ```env
   SPOTIFY_CLIENT_ID=your_client_id
   SPOTIFY_CLIENT_SECRET=your_client_secret
   ```

3. **Run it!**
   ```bash
   docker-compose up -d
   ```

**Done!** Open http://localhost:8000 in your browser.

### Optional: Connect to Navidrome

If you want to download directly to Navidrome, edit `docker-compose.yml`:
```yaml
volumes:
  - /path/to/your/navidrome/music:/music:rw
```

## Configuration

### Environment Variables

Edit `backend/.env` file with your settings:

```env
# Spotify API (required)
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:8000/callback

# Navidrome Configuration
NAVIDROME_MUSIC_PATH=/music  # Inside container, don't change
NAVIDROME_API_URL=http://host.docker.internal:4533  # If Navidrome on host
# Or: NAVIDROME_API_URL=http://navidrome:4533  # If Navidrome in Docker
NAVIDROME_USERNAME=admin
NAVIDROME_PASSWORD=your_password

# Download Configuration
OUTPUT_FORMAT=mp3
AUDIO_QUALITY=128

# API Configuration
API_HOST=0.0.0.0
API_PORT=8000
CORS_ORIGINS=http://localhost:8000
```

### Volume Mounts

The docker-compose.yml mounts:
- **Navidrome music directory**: Maps your host Navidrome music folder to `/music` in the container
- **Downloads directory**: Maps `./downloads` for temporary files (optional but recommended)

### Navidrome Integration

#### If Navidrome is running on the host machine:
```yaml
environment:
  - NAVIDROME_API_URL=http://host.docker.internal:4533
```

#### If Navidrome is running in Docker:
1. Connect to the same network or use external network
2. Use Navidrome service name:
```yaml
environment:
  - NAVIDROME_API_URL=http://navidrome:4533
networks:
  - navidrome-network
networks:
  navidrome-network:
    external: true
```

## Docker Compose Commands

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Rebuild and restart
docker-compose up -d --build

# View running containers
docker-compose ps
```

## Troubleshooting

### Container can't access Navidrome

- If Navidrome is on host: Use `host.docker.internal:4533` (Linux may need `172.17.0.1` instead)
- If Navidrome is in Docker: Ensure both containers are on the same network

### Permission errors with music directory

Make sure the Docker container can write to the mounted volume:
```bash
sudo chown -R 1000:1000 /path/to/navidrome/music
# Or adjust permissions as needed
```

### FFmpeg not found

FFmpeg is installed in the Docker image. If you see errors, ensure you're using the provided Dockerfile.

### Port already in use

Change the port mapping in docker-compose.yml:
```yaml
ports:
  - "8001:8000"  # Use port 8001 on host instead
```

## Building the Image Manually

```bash
docker build -t music-downloader .
docker run -p 8000:8000 \
  -v /path/to/navidrome/music:/music \
  -v $(pwd)/backend/.env:/app/backend/.env \
  music-downloader
```

## Production Deployment

For production:
1. Use environment variables instead of .env file (more secure)
2. Set up a reverse proxy (nginx/traefik) for HTTPS
3. Use Docker secrets for sensitive data
4. Consider using Docker volumes for downloads directory persistence
5. Set resource limits in docker-compose.yml:
   ```yaml
   deploy:
     resources:
       limits:
         cpus: '2'
         memory: 2G
   ```

