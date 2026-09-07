"""Tests for the library fingerprint index (god-tier duplicate detection)."""

import os
from pathlib import Path

import pytest

import config
from utils import library_index


@pytest.fixture()
def idx(tmp_path, monkeypatch):
    """Isolated index DB + library roots."""
    db = tmp_path / "test_index.db"
    music = tmp_path / "music"
    music.mkdir()
    downloads = tmp_path / "downloads"
    (downloads / "temp").mkdir(parents=True)

    monkeypatch.setattr(config, "NAVIDROME_MUSIC_PATHS_LIST", [str(music)])
    monkeypatch.setattr(config, "DOWNLOAD_DIR", str(downloads))
    library_index.configure(str(db))
    library_index.init_library_index_db()
    yield library_index, music, downloads


def _touch(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\0" * 64)


# ============ NORMALIZATION ============

def test_normalize_strips_remaster_and_case():
    assert library_index.normalize_text("Song (Remastered)") == "song"
    assert library_index.normalize_text("SONG") == "song"


def test_normalize_strips_accents():
    assert library_index.normalize_text("Beyoncé") == "beyonce"


def test_normalize_strips_featuring_and_brackets():
    assert library_index.normalize_text("Title [Live] feat. Someone") == "title"
    assert library_index.normalize_text("Track (feat. Guest)") == "track"


def test_first_artist_key():
    assert library_index.first_artist_key("Earth, Wind & Fire") == "earth"
    assert library_index.first_artist_key("A & B") == "a"
    assert library_index.first_artist_key("Solo") == "solo"


# ============ SCAN + MATCH ============

def test_scan_and_find_by_filename_fallback(idx):
    li, music, _ = idx
    _touch(music / "The Beatles" / "Abbey Road" / "The Beatles - Come Together.flac")
    stats = li.scan_library()
    assert stats["total"] == 1

    hits = li.find_track(
        artist="The Beatles", title="Come Together", location="navidrome"
    )
    assert len(hits) == 1
    assert hits[0]["ext"] == ".flac"


def test_fuzzy_match_remaster_suffix(idx):
    li, music, _ = idx
    _touch(music / "Artist" / "Album" / "Artist - Song (Remastered).mp3")
    li.scan_library()

    hits = li.find_track(artist="Artist", title="Song", location="navidrome")
    assert len(hits) == 1


def test_fuzzy_match_featuring_artist(idx):
    li, music, _ = idx
    _touch(music / "A" / "B" / "Main Artist - Track feat. Guest.mp3")
    li.scan_library()

    hits = li.find_track(artist="Main Artist", title="Track", location="navidrome")
    assert len(hits) == 1


def test_no_match_for_different_title(idx):
    li, music, _ = idx
    _touch(music / "A" / "B" / "Artist - Song.mp3")
    li.scan_library()

    assert li.find_track(artist="Artist", title="Other Song", location="navidrome") == []


def test_location_filter_local_vs_navidrome(idx):
    li, music, downloads = idx
    _touch(music / "A" / "B" / "Artist - Nav Track.mp3")
    _touch(downloads / "temp" / "Artist - Local Track.mp3")
    li.scan_library()

    assert li.find_track(artist="Artist", title="Nav Track", location="local") == []
    assert li.find_track(artist="Artist", title="Local Track", location="local") != []
    # Navidrome without a specific library also sees temp/downloads (mirrors track_in_library)
    assert li.find_track(artist="Artist", title="Nav Track", location="navidrome") != []


def test_navidrome_library_path_filter(idx, tmp_path, monkeypatch):
    li, music, _ = idx
    other = tmp_path / "other"
    other.mkdir()
    monkeypatch.setattr(
        config, "NAVIDROME_MUSIC_PATHS_LIST", [str(music), str(other)]
    )
    _touch(music / "A" / "B" / "Artist - Song.mp3")
    li.scan_library()

    assert li.find_track(
        artist="Artist", title="Song",
        location="navidrome", navidrome_library=str(other),
    ) == []
    assert li.find_track(
        artist="Artist", title="Song",
        location="navidrome", navidrome_library=str(music),
    ) != []


def test_stale_rows_removed_on_rescan_and_verify(idx):
    li, music, _ = idx
    f = music / "A" / "B" / "Artist - Gone.mp3"
    _touch(f)
    li.scan_library()
    assert li.find_track(artist="Artist", title="Gone", location="navidrome") != []

    os.remove(f)
    # Before rescan, on-disk verification hides the stale row
    assert li.find_track(artist="Artist", title="Gone", location="navidrome") == []
    # Rescan removes it from the index entirely
    stats = li.scan_library()
    assert stats["removed"] == 1
    assert stats["total"] == 0


def test_incremental_scan_skips_unchanged(idx):
    li, music, _ = idx
    _touch(music / "A" / "B" / "Artist - Song.mp3")
    li.scan_library()
    stats = li.scan_library()
    assert stats["added"] == 0
    assert stats["updated"] == 0
    assert stats["total"] == 1


def test_upsert_file_hook(idx):
    li, music, _ = idx
    target = music / "A" / "B" / "Artist - Hooked.mp3"
    _touch(target)
    li.upsert_file(str(target))
    hits = li.find_track(artist="Artist", title="Hooked", location="navidrome")
    assert len(hits) == 1


def test_cross_artist_album_title_collision_no_match(idx):
    """Self-titled singles collide on album+title across artists — must not match."""
    li, music, _ = idx
    f = music / "1991" / "Chant" / "1991 - Chant.mp3"
    _touch(f)
    li._upsert_row(str(f), os.path.normpath(str(music)), "1991", "Chant", "Chant", ".mp3", 64, 1.0)

    # Different artist, same album+title: NOT a match
    assert li.find_track(
        artist="Other Artist", title="Chant", album="Chant", location="navidrome"
    ) == []
    # The real artist still matches
    assert li.find_track(
        artist="1991", title="Chant", album="Chant", location="navidrome"
    ) != []


def test_album_title_match_when_file_artist_unknown(idx):
    """Album+title may match when the file has no artist tag to contradict it."""
    li, music, _ = idx
    f = music / "X" / "Chant" / "01 Chant.mp3"
    _touch(f)
    li._upsert_row(str(f), os.path.normpath(str(music)), None, "Chant", "Chant", ".mp3", 64, 1.0)

    assert li.find_track(
        artist="1991", title="Chant", album="Chant", location="navidrome"
    ) != []
