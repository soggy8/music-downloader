import os
import requests
from mutagen.id3 import ID3, TIT2, TPE1, TPE2, TALB, APIC, TDRC
from mutagen.mp3 import MP3
from mutagen.flac import FLAC, Picture
from typing import Dict, Optional
from pathlib import Path

class MetadataService:
    def __init__(self):
        pass
    
    def apply_metadata(self, file_path: str, track_info: Dict) -> bool:
        """Apply metadata and album art to audio file"""
        try:
            file_ext = Path(file_path).suffix.lower()
            
            if file_ext == '.mp3':
                return self._apply_mp3_metadata(file_path, track_info)
            elif file_ext == '.flac':
                return self._apply_flac_metadata(file_path, track_info)
            else:
                print(f"Metadata tagging not supported for {file_ext}")
                return False
        
        except Exception as e:
            print(f"Error applying metadata: {e}")
            return False
    
    def _apply_mp3_metadata(self, file_path: str, track_info: Dict) -> bool:
        """Apply metadata to MP3 file"""
        try:
            # Ensure artist names are joined with semicolons
            if 'artist' in track_info:
                track_info['artist'] = track_info['artist'].replace(',', ';')
            # Ensure artist names are joined with semicolons
            if 'album_artist' in track_info:
                track_info['album_artist'] = track_info['album_artist'].replace(',', ';')
                # Extract only the first artist for album artist
                artist_name = track_info['album_artist'].split(';')[0].strip()
                
            audio = MP3(file_path, ID3=ID3)
            
            # Add ID3 tag if it doesn't exist
            try:
                audio.add_tags()
            except:
                pass

            # Set basic metadata
            audio['TIT2'] = TIT2(encoding=3, text=track_info['name'])
            audio['TPE1'] = TPE1(encoding=3, text=track_info['artist'])
            audio['TPE2'] = TPE2(encoding=3, text=artist_name)
            audio['TALB'] = TALB(encoding=3, text=track_info.get('album', ''))
            
            if track_info.get('release_date'):
                audio['TDRC'] = TDRC(encoding=3, text=track_info['release_date'][:4])
            
            # Add album art (use highest quality from Spotify)
            if track_info.get('album_art'):
                try:
                    # Spotify images are sorted by size, first is largest
                    # Replace size parameter in URL to get full resolution if possible
                    art_url = track_info['album_art']
                    # Try to get the highest quality by removing size restrictions
                    if 'i.scdn.co' in art_url:
                        # Spotify CDN - ensure we get full size
                        art_url = art_url.replace('/ab67616d0000b273', '/ab67616d0000b273')  # Full size
                    
                    response = requests.get(art_url, timeout=10, headers={
                        'User-Agent': 'Mozilla/5.0'  # Some CDNs require user agent
                    })
                    if response.status_code == 200:
                        audio.tags.add(APIC(
                            encoding=3,
                            mime='image/jpeg',
                            type=3,
                            desc='Cover',
                            data=response.content
                        ))
                except Exception as e:
                    print(f"Error adding album art: {e}")
            
            audio.save()
            return True
        
        except Exception as e:
            print(f"Error applying MP3 metadata: {e}")
            return False
    
    def _apply_flac_metadata(self, file_path: str, track_info: Dict) -> bool:
        """Apply metadata to FLAC file"""
        try:
            audio = FLAC(file_path)
            
            audio['TITLE'] = track_info['name']
            audio['ARTIST'] = track_info['artist']
            audio['ALBUM'] = track_info.get('album', '')
            
            if track_info.get('release_date'):
                audio['DATE'] = track_info['release_date'][:4]
            
            # Add album art (use highest quality from Spotify)
            if track_info.get('album_art'):
                try:
                    art_url = track_info['album_art']
                    response = requests.get(art_url, timeout=10, headers={
                        'User-Agent': 'Mozilla/5.0'  # Some CDNs require user agent
                    })
                    if response.status_code == 200:
                        picture = Picture()
                        picture.type = 3  # Cover (front)
                        picture.mime = 'image/jpeg'
                        picture.data = response.content
                        audio.add_picture(picture)
                except Exception as e:
                    print(f"Error adding album art: {e}")
            
            audio.save()
            return True
        
        except Exception as e:
            print(f"Error applying FLAC metadata: {e}")
            return False

