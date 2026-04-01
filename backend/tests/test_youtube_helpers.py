"""Unit tests for YouTube download helpers (no network)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from services.youtube import YouTubeService


def test_output_base_path_strips_configured_extension() -> None:
    assert YouTubeService._output_base_path("/tmp/a - b.flac", "flac") == "/tmp/a - b"
    assert YouTubeService._output_base_path("/tmp/a - b.FLAC", "flac") == "/tmp/a - b"


def test_output_base_path_fallback_splitext() -> None:
    # Path does not end with .mp3 — strip last extension only (splitext).
    assert YouTubeService._output_base_path("/tmp/foo.bar", "mp3") == "/tmp/foo"


def test_yt_dlp_outtmpl() -> None:
    assert YouTubeService._yt_dlp_outtmpl("/x/base") == "/x/base.%(ext)s"


def test_ffmpeg_extract_preferredcodec_m4a() -> None:
    assert YouTubeService._ffmpeg_extract_preferredcodec("m4a") == "m4a"


def test_ffmpeg_extract_preferredcodec_flac_mapping() -> None:
    s = YouTubeService._ffmpeg_extract_preferredcodec("flac")
    assert s.startswith("m4a>flac/")
    assert s.endswith("/best>flac")
    assert "webm>flac" in s


def test_preferred_quality_for_extract_flac() -> None:
    assert YouTubeService._preferred_quality_for_extract("flac", "320") == "0"


def test_filepaths_from_info_flat() -> None:
    info = {
        "filepath": "/a/b.webm",
        "requested_downloads": [{"filepath": "/a/b.m4a"}],
    }
    paths = YouTubeService._filepaths_from_info(info)
    assert "/a/b.webm" in paths
    assert "/a/b.m4a" in paths


def test_filepaths_from_info_nested_entries() -> None:
    info = {
        "entries": [
            {"filepath": "/nested/track.flac"},
        ]
    }
    assert "/nested/track.flac" in YouTubeService._filepaths_from_info(info)


def test_resolve_downloaded_audio_expected_path(tmp_path) -> None:
    base = tmp_path / "Artist - Song"
    target = base.with_suffix(".flac")
    target.write_bytes(b"\x00")
    svc = YouTubeService()
    ydl = MagicMock()
    out = svc._resolve_downloaded_audio(
        str(base), "flac", False, {}, ydl
    )
    assert out == str(target)


def test_resolve_downloaded_audio_fallback_same_stem_different_ext(tmp_path) -> None:
    base = tmp_path / "Artist - Song"
    mp3 = base.with_suffix(".mp3")
    mp3.write_bytes(b"\x00")
    svc = YouTubeService()
    ydl = MagicMock()
    ydl.prepare_filename.side_effect = Exception("no")
    out = svc._resolve_downloaded_audio(
        str(base), "flac", False, {}, ydl
    )
    assert out == str(mp3)
