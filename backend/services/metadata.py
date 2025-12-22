import os
import requests
from mutagen.id3 import ID3, TIT2, TPE1, TPE2, TALB, APIC, TDRC, TRCK
from mutagen.mp3 import MP3
from mutagen.flac import FLAC, Picture
from mutagen.oggopus import OggOpus
from mutagen.mp4 import MP4, MP4Cover
from typing import Dict
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
            elif file_ext == '.ogg':
                return self._apply_ogg_metadata(file_path, track_info)
            elif file_ext == '.m4a':
                return self._apply_m4a_metadata(file_path, track_info)
            else:
                print(f"Metadata tagging not supported for {file_ext}")
                return False

        except Exception as e:
            print(f"Error applying metadata: {e}")
            return False
    
    def _get_album_art_bytes(self, track_info: Dict) -> bytes | None:
        art_url = track_info.get('album_art')
        if not art_url:
            return None

        try:
            response = requests.get(art_url, timeout=10, headers={
                'User-Agent': 'Mozilla/5.0'
            })
            if response.status_code == 200:
                return response.content
        except Exception as e:
            print(f"Error downloading album art: {e}")
        return None

    def _apply_mp3_metadata(self, file_path: str, track_info: Dict) -> bool:
        """Apply metadata to MP3 file"""
        try:
            # Ensure artist names are joined with semicolons
            if 'artist' in track_info:
                track_info['artist'] = track_info['artist'].replace(',', ';')

            artist_name = track_info.get('artist', '')

            # Ensure album artist names are joined with semicolons
            if 'album_artist' in track_info and track_info['album_artist']:
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
            audio['TRCK'] = TRCK(encoding=3, text=str(track_info.get('track_number', 1)))
            
            if track_info.get('release_date'):
                audio['TDRC'] = TDRC(encoding=3, text=track_info['release_date'][:4])
            
            # Add album art
            art_bytes = self._get_album_art_bytes(track_info)
            if art_bytes:
                try:
                    audio.tags.add(APIC(
                        encoding=3,
                        mime='image/jpeg',
                        type=3,
                        desc='Cover',
                        data=art_bytes
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
            audio['TRACKNUMBER'] = str(track_info.get('track_number', 1))
            
            if track_info.get('release_date'):
                audio['DATE'] = track_info['release_date'][:4]
            
            # Add album art
            art_bytes = self._get_album_art_bytes(track_info)
            if art_bytes:
                try:
                    picture = Picture()
                    picture.type = 3  # Cover (front)
                    picture.mime = 'image/jpeg'
                    picture.data = art_bytes
                    audio.add_picture(picture)
                except Exception as e:
                    print(f"Error adding album art: {e}")
            
            audio.save()
            return True

        except Exception as e:
            print(f"Error applying FLAC metadata: {e}")
            return False

    def _apply_ogg_metadata(self, file_path: str, track_info: Dict) -> bool:
        """Apply Vorbis-style tags to an Ogg Opus file."""
        try:
            # Normalize separators for multi-artist fields
            if 'artist' in track_info and track_info['artist']:
                track_info['artist'] = track_info['artist'].replace(',', ';')
            if 'album_artist' in track_info and track_info['album_artist']:
                track_info['album_artist'] = track_info['album_artist'].replace(',', ';')

            album_artist = (track_info.get('album_artist') or track_info.get('artist') or '').split(';')[0].strip()

            audio = OggOpus(file_path)
            audio['TITLE'] = track_info.get('name', '')
            audio['ARTIST'] = track_info.get('artist', '')
            audio['ALBUMARTIST'] = album_artist
            audio['ALBUM'] = track_info.get('album', '')
            audio['TRACKNUMBER'] = str(track_info.get('track_number', 1))
            if track_info.get('release_date'):
                audio['DATE'] = str(track_info['release_date'])[:4]

            # Note: embedding cover art in Ogg Opus is non-trivial (METADATA_BLOCK_PICTURE base64).
            # For now, we just write text tags; the remux step ensures mutagen can edit the file reliably.
            audio.save()
            return True
        except Exception as e:
            print(f"Error applying OGG metadata: {e}")
            return False

    def _apply_m4a_metadata(self, file_path: str, track_info: Dict) -> bool:
        """Apply iTunes-style atoms to an M4A file."""
        try:
            # Normalize separators
            if 'artist' in track_info and track_info['artist']:
                track_info['artist'] = track_info['artist'].replace(',', ';')
            if 'album_artist' in track_info and track_info['album_artist']:
                track_info['album_artist'] = track_info['album_artist'].replace(',', ';')

            album_artist = (track_info.get('album_artist') or track_info.get('artist') or '').split(';')[0].strip()

            audio = MP4(file_path)
            audio['\xa9nam'] = track_info.get('name', '')
            audio['\xa9ART'] = track_info.get('artist', '')
            audio['aART'] = album_artist
            audio['\xa9alb'] = track_info.get('album', '')
            audio['trkn'] = [(int(track_info.get('track_number', 1)), 0)]
            if track_info.get('release_date'):
                audio['\xa9day'] = str(track_info['release_date'])[:4]

            art_bytes = self._get_album_art_bytes(track_info)
            if art_bytes:
                try:
                    audio['covr'] = [MP4Cover(art_bytes, imageformat=MP4Cover.FORMAT_JPEG)]
                except Exception as e:
                    print(f"Error adding album art: {e}")

            audio.save()
            return True
        except Exception as e:
            print(f"Error applying M4A metadata: {e}")
            return False

