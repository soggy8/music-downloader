"""Deezer public API — no API key required for catalog search."""
import requests
from typing import List, Dict, Optional
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BASE = "https://api.deezer.com"


def _get(path: str, params: Optional[dict] = None) -> dict:
    url = f"{BASE}{path}" if path.startswith("/") else f"{BASE}/{path}"
    r = requests.get(url, params=params or {}, timeout=15)
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict) and data.get("error"):
        err = data["error"]
        raise RuntimeError(err.get("message", str(err)))
    return data


def _track_from_api(t: dict) -> Dict:
    artist = t.get("artist") or {}
    album = t.get("album") or {}
    artists = [artist["name"]] if artist.get("name") else []
    dur = int(t.get("duration") or 0) * 1000
    cover = album.get("cover_xl") or album.get("cover_big") or album.get("cover_medium")
    return {
        "id": str(t.get("id", "")),
        "name": t.get("title", "Unknown"),
        "artists": artists,
        "artist": artist.get("name", "Unknown"),
        "album": album.get("title", "Unknown"),
        "album_id": str(album.get("id", "")),
        "duration_ms": dur,
        "external_url": t.get("link", ""),
        "preview_url": t.get("preview"),
        "album_art": cover,
        "release_date": (t.get("release_date") or "")[:10],
    }


def _album_from_api(a: dict, artist_fallback: Optional[str] = None) -> Dict:
    artist = a.get("artist") or {}
    artist_name = artist.get("name") or artist_fallback or "Unknown"
    artists = [artist_name] if artist_name != "Unknown" else []
    cover = a.get("cover_xl") or a.get("cover_big") or a.get("cover_medium")
    return {
        "id": str(a.get("id", "")),
        "name": a.get("title", "Unknown"),
        "artist": artist_name,
        "artists": artists,
        "release_date": (a.get("release_date") or "")[:10],
        "total_tracks": int(a.get("nb_tracks") or 0),
        "album_art": cover,
        "external_url": a.get("link", ""),
    }


def _artist_from_api(a: dict) -> Dict:
    picture = a.get("picture_xl") or a.get("picture_big") or a.get("picture_medium")
    return {
        "id": str(a.get("id", "")),
        "name": a.get("name", "Unknown"),
        "artist_art": picture,
        "total_albums": int(a.get("nb_album") or 0),
        "external_url": a.get("link", ""),
    }


def _paged_data(first: dict, cap: int = 200) -> List[dict]:
    items = list(first.get("data") or [])
    next_url = first.get("next")
    while next_url and len(items) < cap:
        try:
            page = requests.get(next_url, timeout=15)
            page.raise_for_status()
            chunk = page.json()
            if isinstance(chunk, dict) and chunk.get("error"):
                err = chunk["error"]
                raise RuntimeError(err.get("message", str(err)))
            items.extend(chunk.get("data") or [])
            next_url = chunk.get("next")
        except Exception as e:
            print(f"Deezer pagination: {e}")
            break
    return items[:cap]


class DeezerService:
    def search_tracks(self, query: str, limit: int = 20) -> List[Dict]:
        limit = max(1, min(int(limit), 100))
        data = _get("/search/track", {"q": query, "limit": limit})
        items = data.get("data") or []
        return [_track_from_api(t) for t in items]

    def get_track_details(self, track_id: str) -> Optional[Dict]:
        try:
            t = _get(f"/track/{track_id}")
        except Exception as e:
            print(f"Deezer track lookup error: {e}")
            return None
        if not t or not t.get("id"):
            return None
        out = _track_from_api(t)
        out["album_artist"] = out["artist"]
        out["album_artists"] = list(out["artists"])
        out["track_number"] = int(t.get("track_position") or 1)
        return out

    def search_albums(self, query: str, limit: int = 20) -> List[Dict]:
        limit = max(1, min(int(limit), 100))
        data = _get("/search/album", {"q": query, "limit": limit})
        items = data.get("data") or []
        return [_album_from_api(a) for a in items]

    def search_artists(self, query: str, limit: int = 20) -> List[Dict]:
        limit = max(1, min(int(limit), 100))
        data = _get("/search/artist", {"q": query, "limit": limit})
        items = data.get("data") or []
        return [_artist_from_api(a) for a in items]

    def get_album_details(self, album_id: str) -> Optional[Dict]:
        try:
            album = _get(f"/album/{album_id}")
        except Exception as e:
            print(f"Deezer album lookup error: {e}")
            return None
        if not album or not album.get("id"):
            return None
        artist = album.get("artist") or {}
        artists = [artist["name"]] if artist.get("name") else []
        cover = album.get("cover_xl") or album.get("cover_big") or album.get("cover_medium")
        release_date = (album.get("release_date") or "")[:10]

        tracks = []
        track_list = album.get("tracks") or {}
        items = track_list.get("data") or []
        for t in items:
            tracks.append(_track_from_api(t))

        next_url = track_list.get("next")
        while next_url:
            try:
                page = requests.get(next_url, timeout=15)
                page.raise_for_status()
                chunk = page.json()
                for t in chunk.get("data") or []:
                    tracks.append(_track_from_api(t))
                next_url = chunk.get("next")
            except Exception as e:
                print(f"Deezer album tracks pagination: {e}")
                break

        for i, tr in enumerate(tracks, start=1):
            tr["track_number"] = i
            tr["album"] = album.get("title", tr.get("album", "Unknown"))
            tr["album_id"] = str(album.get("id", ""))
            tr["album_art"] = cover
            tr["release_date"] = release_date

        return {
            "id": str(album["id"]),
            "name": album.get("title", "Unknown"),
            "artist": artist.get("name", "Unknown"),
            "artists": artists,
            "release_date": release_date,
            "total_tracks": len(tracks),
            "album_art": cover,
            "external_url": album.get("link", ""),
            "tracks": tracks,
        }

    def get_artist_details(self, artist_id: str) -> Optional[Dict]:
        try:
            artist = _get(f"/artist/{artist_id}")
        except Exception as e:
            print(f"Deezer artist lookup error: {e}")
            return None
        if not artist or not artist.get("id"):
            return None
        name = artist.get("name", "Unknown")
        albums = []
        try:
            first = _get(f"/artist/{artist_id}/albums", {"limit": 50})
            for a in _paged_data(first):
                albums.append(_album_from_api(a, artist_fallback=name))
        except Exception as e:
            print(f"Deezer artist albums error: {e}")
        out = _artist_from_api(artist)
        out["albums"] = albums
        if not out["total_albums"]:
            out["total_albums"] = len(albums)
        return out
