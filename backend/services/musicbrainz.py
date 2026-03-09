import os
from typing import List, Dict, Optional

import requests


MUSICBRAINZ_API_BASE = "https://musicbrainz.org/ws/2"
COVERARTARCHIVE_BASE = "https://coverartarchive.org"


def _get_user_agent() -> str:
    """
    MusicBrainz requires a descriptive User-Agent including application name,
    version and contact URL/email.
    """
    app_name = os.getenv("APP_NAME", "music-downloader")
    app_version = os.getenv("APP_VERSION", "1.0.0")
    contact = os.getenv("APP_CONTACT", "https://github.com/soggy8/music-downloader")
    return f"{app_name}/{app_version} ({contact})"


class MusicBrainzService:
    """
    Drop-in replacement for SpotifyService using the public MusicBrainz API.

    Exposes the same high-level methods used by the rest of the app:
    - search_tracks
    - get_track_details
    - search_albums
    - get_album_details
    """

    def __init__(self) -> None:
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": _get_user_agent()})

    # ---- Helpers ---------------------------------------------------------

    def _cover_art_url_for_release(self, release_id: Optional[str]) -> Optional[str]:
        if not release_id:
            return None
        # We don't pre-validate with a request; consumer will handle failures
        return f"{COVERARTARCHIVE_BASE}/release/{release_id}/front-250"

    # ---- Tracks ----------------------------------------------------------

    def _search_recordings(self, query: str, limit: int) -> List[Dict]:
        """Low-level helper that calls the MusicBrainz recording search."""
        params = {
            "query": query,
            "fmt": "json",
            "limit": limit,
        }
        resp = self.session.get(
            f"{MUSICBRAINZ_API_BASE}/recording", params=params, timeout=10
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("recordings", []) or []

    def search_tracks(self, query: str, limit: int = 20) -> List[Dict]:
        """
        Search for recordings (tracks) on MusicBrainz.

        We try a broad full-text query first, and if that returns no
        results, we retry with a more targeted recording-title search.
        """
        limit = max(1, min(int(limit or 20), 50))

        # 1) Broad search (full-text)
        try:
            recordings = self._search_recordings(query, limit)
        except Exception as e:
            print(f"MusicBrainz search error (broad) for '{query}': {e}")
            recordings = []

        # 2) Fallback: targeted recording title search
        if not recordings:
            try:
                recording_query = f'recording:"{query}"'
                recordings = self._search_recordings(recording_query, limit)
            except Exception as e:
                print(f"MusicBrainz search error (fallback) for '{query}': {e}")
                recordings = []
        results: List[Dict] = []

        for rec in recordings:
            rec_id = rec.get("id")
            title = rec.get("title") or ""

            # Artists
            artist_credits = rec.get("artist-credit", []) or []
            artists = []
            for ac in artist_credits:
                name = (ac.get("artist") or {}).get("name")
                if name:
                    artists.append(name)

            artist_str = ", ".join(artists) if artists else ""

            # Use first release (if any) as album
            releases = rec.get("releases", []) or []
            album_title = ""
            album_id = None
            release_date = ""
            if releases:
                first_rel = releases[0]
                album_title = first_rel.get("title") or ""
                album_id = first_rel.get("id")
                release_date = first_rel.get("date") or ""

            duration_ms = int(rec.get("length") or 0)

            track: Dict = {
                "id": rec_id,
                "name": title,
                "artists": artists,
                "artist": artist_str,
                "album": album_title,
                "album_id": album_id,
                "duration_ms": duration_ms,
                "external_url": f"https://musicbrainz.org/recording/{rec_id}" if rec_id else "",
                "preview_url": None,
                "album_art": self._cover_art_url_for_release(album_id),
                "release_date": release_date,
            }
            results.append(track)

        return results

    def get_track_details(self, track_id: str) -> Optional[Dict]:
        """
        Get detailed information about a specific recording.
        """
        if not track_id:
            return None

        params = {
            "inc": "artists+releases",
            "fmt": "json",
        }
        resp = self.session.get(f"{MUSICBRAINZ_API_BASE}/recording/{track_id}", params=params, timeout=10)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        rec = resp.json()

        title = rec.get("title") or ""

        # Artists
        artist_credits = rec.get("artist-credit", []) or []
        artists = []
        for ac in artist_credits:
            name = (ac.get("artist") or {}).get("name")
            if name:
                artists.append(name)
        artist_str = ", ".join(artists) if artists else ""

        # Album / release
        releases = rec.get("releases", []) or []
        album_title = ""
        album_id = None
        album_artists = artists[:]  # fallback
        release_date = ""
        track_number = 1

        if releases:
            first_rel = releases[0]
            album_title = first_rel.get("title") or ""
            album_id = first_rel.get("id")
            release_date = first_rel.get("date") or ""
            # Track number may be provided on medium-list/track-list in other endpoints;
            # here we don't have a simple per-release track number, so keep default = 1.

        album_artist_str = ", ".join(album_artists) if album_artists else artist_str

        duration_ms = int(rec.get("length") or 0)

        return {
            "id": rec.get("id"),
            "name": title,
            "artists": artists,
            "artist": artist_str,
            "album_artists": album_artists,
            "album_artist": album_artist_str,
            "album": album_title,
            "album_id": album_id,
            "duration_ms": duration_ms,
            "external_url": f"https://musicbrainz.org/recording/{rec.get('id')}" if rec.get("id") else "",
            "preview_url": None,
            "track_number": track_number,
            "album_art": self._cover_art_url_for_release(album_id),
            "release_date": release_date,
        }

    # ---- Albums ----------------------------------------------------------

    def search_albums(self, query: str, limit: int = 20) -> List[Dict]:
        """
        Search for album-like release groups on MusicBrainz.
        """
        limit = max(1, min(int(limit or 20), 50))
        params = {
            "query": query,
            "fmt": "json",
            "limit": limit,
            "type": "album",
        }

        try:
            resp = self.session.get(
                f"{MUSICBRAINZ_API_BASE}/release-group", params=params, timeout=10
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.HTTPError as e:
            status = getattr(e.response, "status_code", None)
            if status == 503:
                # MusicBrainz is temporarily unavailable; log and return empty list
                print(
                    f"MusicBrainz album search 503 for query '{query}': service temporarily unavailable"
                )
                return []
            print(f"MusicBrainz album search error for query '{query}': {e}")
            raise
        except Exception as e:
            print(f"MusicBrainz album search unexpected error for query '{query}': {e}")
            raise

        rgs = data.get("release-groups", []) or []
        results: List[Dict] = []

        for rg in rgs:
            rg_id = rg.get("id")
            title = rg.get("title") or ""

            # Artist credits
            artist_credits = rg.get("artist-credit", []) or []
            artists = []
            for ac in artist_credits:
                name = (ac.get("artist") or {}).get("name")
                if name:
                    artists.append(name)
            artist_str = ", ".join(artists) if artists else ""

            # Take first release (if any) for date / art / track count
            first_release = None
            rels = rg.get("releases", []) or []
            if rels:
                first_release = rels[0]

            release_date = ""
            total_tracks = 0
            album_art = None
            if first_release:
                release_date = first_release.get("date") or ""
                release_id = first_release.get("id")
                album_art = self._cover_art_url_for_release(release_id)

                # Try to get an accurate track count for this release
                if release_id:
                    try:
                        rel_resp = self.session.get(
                            f"{MUSICBRAINZ_API_BASE}/release/{release_id}",
                            params={"fmt": "json"},
                            timeout=10,
                        )
                        rel_resp.raise_for_status()
                        rel_data = rel_resp.json()
                        # MusicBrainz release JSON has "track-count"
                        total_tracks = int(rel_data.get("track-count") or 0)
                    except Exception as e:
                        # Don't fail the search if track-count lookup fails
                        print(
                            f"MusicBrainz album track-count lookup failed for release {release_id}: {e}"
                        )

            album: Dict = {
                "id": rg_id,
                "name": title,
                "artist": artist_str,
                "artists": artists,
                "release_date": release_date,
                "total_tracks": total_tracks,
                "album_art": album_art,
                "external_url": f"https://musicbrainz.org/release-group/{rg_id}" if rg_id else "",
            }
            results.append(album)

        return results

    def get_album_details(self, album_id: str) -> Optional[Dict]:
        """
        Get detailed information about an album including all tracks.

        Here album_id is treated as a MusicBrainz release-group ID. We:
        1. Fetch the release-group
        2. Choose the first release
        3. Fetch that release with recordings to build the track list
        """
        if not album_id:
            return None

        # 1. Release group
        rg_params = {"inc": "artist-credits+releases", "fmt": "json"}
        rg_resp = self.session.get(
            f"{MUSICBRAINZ_API_BASE}/release-group/{album_id}", params=rg_params, timeout=10
        )
        if rg_resp.status_code == 404:
            return None
        rg_resp.raise_for_status()
        rg = rg_resp.json()

        title = rg.get("title") or ""

        # Artists
        artist_credits = rg.get("artist-credit", []) or []
        artists = []
        for ac in artist_credits:
            name = (ac.get("artist") or {}).get("name")
            if name:
                artists.append(name)
        artist_str = ", ".join(artists) if artists else ""

        # Choose first release
        releases = rg.get("releases", []) or []
        if not releases:
            return {
                "id": album_id,
                "name": title,
                "artist": artist_str,
                "artists": artists,
                "release_date": "",
                "total_tracks": 0,
                "album_art": None,
                "external_url": f"https://musicbrainz.org/release-group/{album_id}",
                "tracks": [],
            }

        first_release = releases[0]
        release_id = first_release.get("id")

        # 2. Fetch release with recordings
        rel_params = {"inc": "recordings+artist-credits", "fmt": "json"}
        rel_resp = self.session.get(
            f"{MUSICBRAINZ_API_BASE}/release/{release_id}", params=rel_params, timeout=10
        )
        rel_resp.raise_for_status()
        rel = rel_resp.json()

        release_date = rel.get("date") or first_release.get("date") or ""
        album_art = self._cover_art_url_for_release(release_id)

        tracks: List[Dict] = []
        media_list = rel.get("media", []) or []

        for medium in media_list:
            track_list = medium.get("tracks", []) or []
            for t in track_list:
                rec = t.get("recording") or {}
                rec_id = rec.get("id")
                rec_title = rec.get("title") or ""

                # Artists for track
                t_artists = []
                for ac in (rec.get("artist-credit") or []):
                    nm = (ac.get("artist") or {}).get("name")
                    if nm:
                        t_artists.append(nm)
                t_artist_str = ", ".join(t_artists) if t_artists else artist_str

                duration_ms = int(rec.get("length") or 0)
                track_number = int(t.get("position") or 0) or int(t.get("number") or 0) or 1

                track_info: Dict = {
                    "id": rec_id,
                    "name": rec_title,
                    "artists": t_artists,
                    "artist": t_artist_str,
                    "album": title,
                    "album_id": album_id,
                    "duration_ms": duration_ms,
                    "track_number": track_number,
                    "external_url": f"https://musicbrainz.org/recording/{rec_id}" if rec_id else "",
                    "preview_url": None,
                    "album_art": album_art,
                    "release_date": release_date,
                }
                tracks.append(track_info)

        return {
            "id": album_id,
            "name": title,
            "artist": artist_str,
            "artists": artists,
            "release_date": release_date,
            "total_tracks": len(tracks),
            "album_art": album_art,
            "external_url": f"https://musicbrainz.org/release-group/{album_id}",
            "tracks": tracks,
        }

