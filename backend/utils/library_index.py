"""
Persistent library fingerprint index for fast, fuzzy duplicate detection.

Scans Navidrome music roots (and the local downloads/temp dirs) into SQLite,
keyed by *normalized* artist/album/title from tags (filename fallback).
Lookups are pure DB queries — no catalog API calls, no directory walking on
the hot path — so "already in library" checks are instant and tolerate
different naming schemes, featuring-artist suffixes, remaster tags, and
different audio formats.
"""
from __future__ import annotations

import os
import re
import sqlite3
import threading
import time
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import config
from utils.job_store import JOBS_DB_PATH
from utils.navidrome_library_sync import (
    AUDIO_EXTENSIONS,
    _first_tag_value,
    _parse_filename_stem,
)

_DB_PATH: str = JOBS_DB_PATH

_scan_lock = threading.Lock()
_last_scan_ms: Optional[int] = None

# Roots that are not Navidrome libraries but still count as "have the file"
DOWNLOADS_ROOT = "__downloads__"
TEMP_ROOT = "__temp__"


def configure(db_path: str) -> None:
    """Override the DB path (used by tests)."""
    global _DB_PATH
    _DB_PATH = db_path


def _now_ms() -> int:
    return int(time.time() * 1000)


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=5, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    return conn


def init_library_index_db() -> None:
    conn = _db()
    try:
        conn.execute("""
        CREATE TABLE IF NOT EXISTS library_files (
            path TEXT PRIMARY KEY,
            root TEXT NOT NULL,
            artist TEXT,
            album TEXT,
            title TEXT,
            n_artist TEXT,
            n_first_artist TEXT,
            n_album TEXT,
            n_title TEXT,
            ext TEXT,
            size INTEGER,
            mtime REAL,
            indexed_at_ms INTEGER NOT NULL
        )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_library_files_ntitle ON library_files(n_title)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_library_files_nartist ON library_files(n_artist)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_library_files_root ON library_files(root)")
        conn.commit()
    finally:
        conn.close()


# ============ NORMALIZATION ============

_BRACKETS_RE = re.compile(r"[\(\[\{][^\)\]\}]*[\)\]\}]")
_FEAT_RE = re.compile(
    r"\b(feat\.?|ft\.?|featuring|with|w/)\b.*$", re.IGNORECASE
)
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
_ARTIST_SPLIT_RE = re.compile(r"\s*(?:;|/|\s+&\s+|\s+x\s+|,)\s*", re.IGNORECASE)


def normalize_text(s: Optional[str]) -> str:
    """Aggressive normalization for matching: accents stripped, bracketed
    suffixes ('(Remastered)', '[Live]') and 'feat. …' tails removed,
    alphanumeric only."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower()
    s = _BRACKETS_RE.sub(" ", s)
    s = _FEAT_RE.sub(" ", s)
    return _NON_ALNUM_RE.sub("", s)


def first_artist_key(artist: Optional[str]) -> str:
    """Normalized key of just the primary artist ('A & B' -> 'a')."""
    if not artist:
        return ""
    parts = _ARTIST_SPLIT_RE.split(str(artist), maxsplit=1)
    return normalize_text(parts[0] if parts else artist)


# ============ TAG READING ============

def read_tags(path: Path) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Read (artist, album, title) from tags, with filename fallback."""
    artist = album = title = None
    try:
        from mutagen import File as MutagenFile

        audio = MutagenFile(str(path))
    except Exception:
        audio = None

    if audio is not None:
        artist = _first_tag_value(
            audio,
            ("TPE1", "TPE2", "TXXX:artist", "artist", "ARTIST",
             "Album Artist", "albumartist", "©ART"),
        )
        album = _first_tag_value(
            audio, ("TALB", "album", "ALBUM", "©alb")
        )
        title = _first_tag_value(
            audio, ("TIT2", "title", "TITLE", "TXXX:title", "©nam")
        )

    if not artist or not title:
        parsed = _parse_filename_stem(path)
        if parsed:
            if not artist:
                artist = parsed[0]
            if not title:
                title = parsed[1]
    return (artist, album, title)


# ============ SCANNING ============

def _iter_audio_files(root: Path):
    if not root.is_dir():
        return
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in filenames:
            p = Path(dirpath) / fn
            if p.suffix.lower() in AUDIO_EXTENSIONS:
                yield p


def _scan_roots() -> List[Tuple[str, Path]]:
    """(root_key, directory) pairs to index."""
    roots: List[Tuple[str, Path]] = []
    for p in config.NAVIDROME_MUSIC_PATHS_LIST:
        roots.append((os.path.normpath(p), Path(p)))
    dl = Path(config.DOWNLOAD_DIR)
    roots.append((DOWNLOADS_ROOT, dl))
    roots.append((TEMP_ROOT, dl / "temp"))
    return roots


def upsert_file(file_path: str, root: Optional[str] = None) -> None:
    """Index a single file (called right after a download lands)."""
    p = Path(file_path)
    if not p.is_file() or p.suffix.lower() not in AUDIO_EXTENSIONS:
        return
    if root is None:
        root = _root_for_path(p)
    artist, album, title = read_tags(p)
    try:
        st = p.stat()
    except OSError:
        return
    _upsert_row(str(p), root, artist, album, title, p.suffix.lower(), st.st_size, st.st_mtime)


def _root_for_path(p: Path) -> str:
    s = str(p)
    for root_key, root_dir in _scan_roots():
        try:
            if root_key not in (DOWNLOADS_ROOT, TEMP_ROOT) and os.path.commonpath([s, str(root_dir)]) == str(root_dir):
                return root_key
        except ValueError:
            continue
    temp_dir = Path(config.DOWNLOAD_DIR) / "temp"
    try:
        if os.path.commonpath([s, str(temp_dir)]) == str(temp_dir):
            return TEMP_ROOT
    except ValueError:
        pass
    return DOWNLOADS_ROOT


def _upsert_row(path: str, root: str, artist: Optional[str], album: Optional[str],
                title: Optional[str], ext: str, size: int, mtime: float) -> None:
    conn = _db()
    try:
        conn.execute("""
        INSERT INTO library_files (
            path, root, artist, album, title, n_artist, n_first_artist,
            n_album, n_title, ext, size, mtime, indexed_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
            root=excluded.root, artist=excluded.artist, album=excluded.album,
            title=excluded.title, n_artist=excluded.n_artist,
            n_first_artist=excluded.n_first_artist, n_album=excluded.n_album,
            n_title=excluded.n_title, ext=excluded.ext, size=excluded.size,
            mtime=excluded.mtime, indexed_at_ms=excluded.indexed_at_ms
        """, (
            path, root, artist, album, title,
            normalize_text(artist), first_artist_key(artist),
            normalize_text(album), normalize_text(title),
            ext, size, mtime, _now_ms(),
        ))
        conn.commit()
    finally:
        conn.close()


def scan_library() -> Dict[str, int]:
    """Incremental rescan of all roots. Only reads tags for new/changed files.
    No network calls — safe to run often."""
    global _last_scan_ms
    with _scan_lock:
        init_library_index_db()
        stats = {"scanned": 0, "added": 0, "updated": 0, "removed": 0, "total": 0}
        seen: set = set()

        conn = _db()
        try:
            existing = {
                r["path"]: (r["size"], r["mtime"])
                for r in conn.execute("SELECT path, size, mtime FROM library_files")
            }

            for root_key, root_dir in _scan_roots():
                for p in _iter_audio_files(root_dir):
                    sp = str(p)
                    seen.add(sp)
                    try:
                        st = p.stat()
                    except OSError:
                        continue
                    stats["scanned"] += 1
                    prev = existing.get(sp)
                    if prev and prev[0] == st.st_size and abs(prev[1] - st.st_mtime) < 1e-6:
                        continue  # unchanged
                    artist, album, title = read_tags(p)
                    _upsert_row(sp, root_key, artist, album, title,
                                p.suffix.lower(), st.st_size, st.st_mtime)
                    stats["added" if prev is None else "updated"] += 1

            stale = [path for path in existing if path not in seen]
            if stale:
                conn.executemany(
                    "DELETE FROM library_files WHERE path = ?",
                    [(s,) for s in stale],
                )
                conn.commit()
                stats["removed"] = len(stale)

            stats["total"] = conn.execute(
                "SELECT COUNT(*) AS n FROM library_files"
            ).fetchone()["n"]
        finally:
            conn.close()

        _last_scan_ms = _now_ms()
        return stats


# ============ LOOKUP ============

def _roots_for_query(location: str, navidrome_library: Optional[str]) -> Optional[set]:
    """Which roots count for a query. None means 'any root'."""
    if location == "local":
        return {DOWNLOADS_ROOT, TEMP_ROOT}
    if location == "navidrome":
        if navidrome_library:
            return {os.path.normpath(navidrome_library)}
        return set(os.path.normpath(p) for p in config.NAVIDROME_MUSIC_PATHS_LIST) | {
            DOWNLOADS_ROOT, TEMP_ROOT
        }
    return None


def find_track(artist: Optional[str], title: Optional[str],
               album: Optional[str] = None,
               location: Optional[str] = None,
               navidrome_library: Optional[str] = None,
               verify_on_disk: bool = True) -> List[Dict[str, Any]]:
    """Return matching library rows for (artist, album, title).

    Tiers: strong = exact normalized title + (artist or album) match;
    medium = exact title + artist containment. Callers should treat any
    returned row as 'already have it'."""
    nt = normalize_text(title)
    if not nt:
        return []
    na = normalize_text(artist)
    nfa = first_artist_key(artist)
    nal = normalize_text(album)
    roots = _roots_for_query(location, navidrome_library) if location else None

    conn = _db()
    try:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM library_files WHERE n_title = ?", (nt,)
        )]
    finally:
        conn.close()

    matches: List[Dict[str, Any]] = []
    for r in rows:
        if roots is not None and r["root"] not in roots:
            continue

        artist_exact = bool(
            na and (r["n_artist"] == na or (nfa and r["n_first_artist"] == nfa))
        )
        artist_overlap = bool(
            na and r["n_artist"] and (na in r["n_artist"] or r["n_artist"] in na)
        )
        # Artist info exists on both sides and clearly disagrees -> reject,
        # even if album+title collide (self-titled singles across artists).
        artist_contradicts = bool(na and r["n_artist"]) and not artist_exact and not artist_overlap

        strong = False
        medium = False
        if artist_exact:
            strong = True
        elif nal and r["n_album"] == nal and not artist_contradicts:
            strong = True
        elif artist_overlap and not artist_contradicts:
            medium = True
        if not (strong or medium):
            continue
        if verify_on_disk and not os.path.isfile(r["path"]):
            continue  # stale row (e.g. temp file already cleaned up)
        r["_match"] = "strong" if strong else "medium"
        matches.append(r)
    return matches


def index_stats() -> Dict[str, Any]:
    init_library_index_db()
    conn = _db()
    try:
        total = conn.execute("SELECT COUNT(*) AS n FROM library_files").fetchone()["n"]
        by_root = {
            r["root"]: r["n"]
            for r in conn.execute(
                "SELECT root, COUNT(*) AS n FROM library_files GROUP BY root"
            )
        }
    finally:
        conn.close()
    return {
        "total": total,
        "by_root": by_root,
        "last_scan_ms": _last_scan_ms,
    }


# ============ BACKGROUND REFRESH ============

def start_library_index_background() -> None:
    """Initial scan at startup, then cheap stat-diff rescans on an interval."""
    interval_sec = max(60, int(config.LIBRARY_INDEX_REFRESH_MINUTES * 60))

    def runner() -> None:
        while True:
            try:
                stats = scan_library()
                print(
                    f"Library index: {stats['total']} files "
                    f"(+{stats['added']} new, {stats['updated']} updated, "
                    f"{stats['removed']} removed)"
                )
            except Exception as e:
                print(f"Library index scan failed: {e}")
            time.sleep(interval_sec)

    t = threading.Thread(target=runner, daemon=True, name="library-index-scan")
    t.start()
    print(
        f"Library index: background thread started "
        f"(scan now, then every {interval_sec // 60}min)"
    )
