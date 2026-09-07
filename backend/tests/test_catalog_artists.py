"""Artist search mapping (no live catalog calls)."""

from __future__ import annotations

from services.deezer import DeezerService, _artist_from_api, _album_from_api
from services.spotify import SpotifyService


def test_deezer_artist_from_api() -> None:
    out = _artist_from_api({
        "id": 27,
        "name": "Daft Punk",
        "picture_xl": "https://example.com/xl.jpg",
        "nb_album": 12,
        "link": "https://www.deezer.com/artist/27",
    })
    assert out["id"] == "27"
    assert out["name"] == "Daft Punk"
    assert out["artist_art"] == "https://example.com/xl.jpg"
    assert out["total_albums"] == 12


def test_deezer_album_from_api_uses_artist_fallback() -> None:
    out = _album_from_api(
        {"id": 1, "title": "Discovery", "cover_big": "c.jpg", "nb_tracks": 14, "link": "l"},
        artist_fallback="Daft Punk",
    )
    assert out["artist"] == "Daft Punk"
    assert out["name"] == "Discovery"


def test_deezer_search_artists(monkeypatch) -> None:
    def fake_get(path, params=None):
        assert path == "/search/artist"
        return {"data": [{"id": 27, "name": "Daft Punk", "nb_album": 12}]}

    monkeypatch.setattr("services.deezer._get", fake_get)
    out = DeezerService().search_artists("daft")
    assert len(out) == 1
    assert out[0]["name"] == "Daft Punk"


def test_spotify_artist_from_api() -> None:
    svc = object.__new__(SpotifyService)
    out = svc._artist_from_api({
        "id": "abc",
        "name": "Radiohead",
        "images": [{"url": "https://example.com/a.jpg"}],
        "external_urls": {"spotify": "https://open.spotify.com/artist/abc"},
    })
    assert out["id"] == "abc"
    assert out["artist_art"] == "https://example.com/a.jpg"
    assert out["total_albums"] == 0


def test_deezer_get_artist_details(monkeypatch) -> None:
    def fake_get(path, params=None):
        if path == "/artist/27":
            return {"id": 27, "name": "Daft Punk", "nb_album": 2, "picture_xl": "p.jpg"}
        if path == "/artist/27/albums":
            return {"data": [{"id": 1, "title": "Discovery", "nb_tracks": 14}]}
        raise AssertionError(path)

    monkeypatch.setattr("services.deezer._get", fake_get)
    out = DeezerService().get_artist_details("27")
    assert out["name"] == "Daft Punk"
    assert out["albums"][0]["name"] == "Discovery"
    assert out["albums"][0]["artist"] == "Daft Punk"


def test_spotify_get_artist_details_keeps_artist_if_albums_fail() -> None:
    svc = object.__new__(SpotifyService)

    def fake_call(func, *args, **kwargs):
        if func is svc.client.artist:
            return {"id": "abc", "name": "Radiohead", "images": [], "external_urls": {}}
        raise RuntimeError("albums down")

    svc.client = type("C", (), {"artist": object(), "artist_albums": object()})()
    svc._call = fake_call
    out = svc.get_artist_details("abc")
    assert out["name"] == "Radiohead"
    assert out["albums"] == []
