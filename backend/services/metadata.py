import os
import requests
from mutagen.id3 import ID3, TIT2, TPE1, TPE2, TALB, APIC, TDRC, TRCK
from mutagen.mp3 import MP3
from mutagen.flac import FLAC, Picture
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
            elif file_ext == '.m4a':
                return self._apply_m4a_metadata(file_path, track_info)
            else:
                print(f"Metadata tagging not supported for {file_ext}")
                return False

        except Exception as e:
            print(f"Error applying metadata: {e}")
            return False

    def _download_album_art(self, url: str) -> bytes | None:
        if not url:
            return None
        try:
            response = requests.get(url, timeout=10, headers={'User-Agent': 'Mozilla/5.0'})
            if response.status_code == 200:
                return response.content
        except Exception as e:
            print(f"Error downloading album art: {e}")
        return None

    def _apply_mp3_metadata(self, file_path: str, track_info: Dict) -> bool:
        """Apply metadata to MP3 file"""
        try:
            # Ensure artist names are joined with semicolons
            if 'artist' in track_info and isinstance(track_info.get('artist'), str):
                track_info['artist'] = track_info['artist'].replace(',', ';')

            artist_name = ''
            if 'album_artist' in track_info and isinstance(track_info.get('album_artist'), str):
                track_info['album_artist'] = track_info['album_artist'].replace(',', ';')
                # Extract only the first artist for album artist
                artist_name = track_info['album_artist'].split(';')[0].strip()

            audio = MP3(file_path, ID3=ID3)

            # Add ID3 tag if it doesn't exist
            try:
                audio.add_tags()
            except Exception:
                pass

            # Set basic metadata
            audio['TIT2'] = TIT2(encoding=3, text=track_info.get('name', ''))
            audio['TPE1'] = TPE1(encoding=3, text=track_info.get('artist', ''))
            audio['TPE2'] = TPE2(encoding=3, text=artist_name)
            audio['TALB'] = TALB(encoding=3, text=track_info.get('album', ''))
            audio['TRCK'] = TRCK(encoding=3, text=str(track_info.get('track_number', 1)))

            if track_info.get('release_date'):
                audio['TDRC'] = TDRC(encoding=3, text=str(track_info['release_date'])[:4])

            # Add album art
            if track_info.get('album_art'):
                art_bytes = self._download_album_art(track_info.get('album_art'))
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

            audio['TITLE'] = track_info.get('name', '')
            audio['ARTIST'] = track_info.get('artist', '')
            audio['ALBUM'] = track_info.get('album', '')
            audio['TRACKNUMBER'] = str(track_info.get('track_number', 1))

            if track_info.get('release_date'):
                audio['DATE'] = str(track_info['release_date'])[:4]

            if track_info.get('album_art'):
                art_bytes = self._download_album_art(track_info.get('album_art'))
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

    def _apply_m4a_metadata(self, file_path: str, track_info: Dict) -> bool:
        """Apply metadata to M4A (MP4) file."""
        try:
            audio = MP4(file_path)

            title = track_info.get('name', '')
            artist = track_info.get('artist', '')
            album = track_info.get('album', '')
            track_number = track_info.get('track_number', 1)
            album_artist = track_info.get('album_artist')

            if isinstance(artist, str):
                # MP4 typically expects a list for artists
                artists = [a.strip() for a in artist.replace(';', ',').split(',') if a.strip()]
            else:
                artists = []

            audio['\xa9nam'] = [title] if title else []
            audio['\xa9ART'] = artists
            audio['\xa9alb'] = [album] if album else []

            if album_artist and isinstance(album_artist, str):
                aa = album_artist.split(',')[0].split(';')[0].strip()
                audio['aART'] = [aa] if aa else []

            # track number is tuple: (track, total)
            try:
                audio['trkn'] = [(int(track_number), 0)]
            except Exception:
                pass

            if track_info.get('release_date'):
                year = str(track_info['release_date'])[:4]
                audio['\xa9day'] = [year]

            # Album art
            art_url = track_info.get('album_art')
            if art_url:
                art_bytes = self._download_album_art(art_url)
                if art_bytes:
                    # Mutagen uses MP4Cover with imageformat
                    cover = MP4Cover(art_bytes, imageformat=MP4Cover.FORMAT_JPEG)
                    audio['covr'] = [cover]

            audio.save()
            return True

        except Exception as e:
            print(f"Error applying M4A metadata: {e}")
            return False

