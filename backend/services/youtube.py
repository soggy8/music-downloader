import yt_dlp
import os
import re
from typing import Optional, Dict
from pathlib import Path
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import config

class YouTubeService:
    def __init__(self):
        self.output_format = config.OUTPUT_FORMAT
        self.audio_quality = config.AUDIO_QUALITY
    
    def search_and_download(self, track_name: str, artist: str, output_path: str, track_info: Dict = None) -> Dict:
        """Search YouTube for a track and download it"""
        # Create more specific search query to get better matches
        # Include album name if available for better matching
        if track_info and track_info.get('album'):
            query = f"{artist} {track_name} {track_info.get('album')} official"
        else:
            query = f"{artist} {track_name} official audio"
        
        # Convert to absolute path to avoid filesystem issues
        output_path = os.path.abspath(output_path)
        base_path = output_path.replace(f'.{self.output_format}', '')
        
        ydl_opts = {
            'format': 'bestaudio[ext=m4a]/bestaudio/best[height<=720]/best',
            # Robust user agent to avoid 403 errors
            'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            # Try different YouTube clients as fallback (helps with 403 errors)
            'extractor_args': {
                'youtube': {
                    'player_client': ['android', 'web', 'ios'],  # Try multiple clients
                }
            },
            # Retry configuration for network issues and 403 errors
            'retries': 10,
            'fragment_retries': 10,
            'file_access_retries': 3,
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': self.output_format,
                'preferredquality': self.audio_quality,
                'nopostoverwrites': False,
            }],
            'postprocessor_args': {
                'ffmpeg': [
                    '-af', 'aresample=44100',  # Resample to 44.1kHz (fixes speed issues)
                    '-ac', '2',                # Stereo channels
                ]
            },
            'outtmpl': base_path,
            'fixup': 'never',  # Skip FixupM4a which causes filesystem errors
            'quiet': False,
            'no_warnings': False,
            'default_search': 'ytsearch1',  # Search and get first result
            'noplaylist': True,
            'extract_flat': False,
            'writesubtitles': False,
            'writeautomaticsub': False,
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                # Search and download in one step (faster)
                search_query = f"ytsearch1:{query}"
                info = ydl.extract_info(search_query, download=True)
                
                # Extract actual video info from ytsearch result (it returns entries)
                if 'entries' in info and info['entries']:
                    video_entry = info['entries'][0]
                    if video_entry:
                        # Validate the match after download
                        youtube_title = (video_entry.get('title') or info.get('title') or '').lower()
                        youtube_uploader = (video_entry.get('uploader') or info.get('uploader') or '').lower()
                        
                        track_name_lower = track_name.lower()
                        artist_parts = [a.strip().lower() for a in artist.lower().split(',')]
                        main_artist = artist_parts[0] if artist_parts else ''
                        
                        # Check if title contains key words from track name
                        track_words = [w for w in track_name_lower.split() if len(w) > 2]
                        title_match = track_name_lower in youtube_title or any(word in youtube_title for word in track_words)
                        artist_match = main_artist in youtube_title or main_artist in youtube_uploader
                        
                        # Log for debugging (non-blocking)
                        print(f"YouTube result: '{video_entry.get('title') or info.get('title')}' by '{video_entry.get('uploader') or info.get('uploader')}'")
                        print(f"Looking for: '{track_name}' by '{artist}' - Match: title={title_match}, artist={artist_match}")
                        
                        # Use the video entry info for return value
                        if video_entry.get('title'):
                            info = video_entry
                
                # yt-dlp returns the actual filename in info dict
                # Try to get the downloaded file path (base_path already set above as absolute)
                actual_path = None
                
                # Check for file with expected extension first (base_path is already absolute)
                expected_path = f"{base_path}.{self.output_format}"
                
                # Use expected path if it exists (most common case)
                if os.path.exists(expected_path):
                    actual_path = expected_path
                else:
                    # Check for other possible extensions (before conversion)
                    for ext in ['m4a', 'webm', 'opus']:
                        test_path = f"{base_path}.{ext}"
                        if os.path.exists(test_path):
                            # File exists but hasn't been converted yet - this shouldn't happen
                            # as FFmpeg should have converted it, but handle it anyway
                            actual_path = test_path
                            break
                        
                        # Check numbered variants (yt-dlp adds these if file exists)
                        if not actual_path:
                            for i in range(10):
                                test_path = f"{base_path}-{i}.{ext}"
                                if os.path.exists(test_path):
                                    actual_path = test_path
                                    break
                            if actual_path:
                                break
                    
                    # Also check numbered variants of the final format
                    if not actual_path:
                        for i in range(10):
                            test_path = f"{base_path}-{i}.{self.output_format}"
                            if os.path.exists(test_path):
                                actual_path = test_path
                                break
                
                if not actual_path:
                    # Last resort: try to get from info dict
                    filename = ydl.prepare_filename(info)
                    if os.path.exists(filename):
                        actual_path = filename
                    elif os.path.exists(filename.replace('.webm', f'.{self.output_format}')):
                        actual_path = filename.replace('.webm', f'.{self.output_format}')
                    elif os.path.exists(filename.replace('.m4a', f'.{self.output_format}')):
                        actual_path = filename.replace('.m4a', f'.{self.output_format}')
                    else:
                        raise FileNotFoundError(f"Downloaded file not found. Expected: {expected_path}")
                
                return {
                    'success': True,
                    'file_path': actual_path,
                    'title': info.get('title', track_name),
                    'duration': info.get('duration', 0),
                    'url': info.get('webpage_url', '')
                }
        
        except Exception as e:
            error_msg = str(e)
            
            # Provide helpful error messages for common issues
            if '403' in error_msg or 'Forbidden' in error_msg:
                error_msg = "YouTube blocked the request (HTTP 403). This can happen due to rate limiting, IP blocking, or YouTube's anti-bot measures. Try again in a few minutes, or ensure yt-dlp is up to date: pip install --upgrade yt-dlp"
            elif 'HTTP Error' in error_msg:
                error_msg = f"Network error: {error_msg}. Check your internet connection and try again."
            elif 'unable to download video data' in error_msg.lower():
                error_msg = f"YouTube download failed: {error_msg}. This may be due to the video being unavailable, region-locked, or YouTube blocking the request. Try a different track or wait a few minutes."
            
            print(f"YouTube download error: {e}")
            return {
                'success': False,
                'error': error_msg
            }
    
    def sanitize_filename(self, filename: str) -> str:
        """Remove invalid characters from filename"""
        # Remove invalid characters
        filename = re.sub(r'[<>:"/\\|?*]', '', filename)
        # Replace multiple spaces with single space
        filename = re.sub(r'\s+', ' ', filename)
        # Trim
        filename = filename.strip()
        return filename

