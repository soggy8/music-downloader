const METADATA_PROVIDER_STORAGE = 'musikat_metadata_provider';

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : text;
    return div.innerHTML;
}

// ============ TOASTS ============

function getToastContainer() {
    let c = document.getElementById('toastContainer');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toastContainer';
        c.className = 'toast-container';
        c.setAttribute('aria-live', 'polite');
        document.body.appendChild(c);
    }
    return c;
}

function showToast(message, type = 'info', durationMs = 4500) {
    const container = getToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-message">${escapeHtml(message)}</span>`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    toast.appendChild(close);
    container.appendChild(toast);

    let removed = false;
    const dismiss = () => {
        if (removed) return;
        removed = true;
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 200);
    };
    close.addEventListener('click', dismiss);
    if (durationMs > 0) setTimeout(dismiss, durationMs);
    return dismiss;
}

// ============ RECENT SEARCHES ============

const RECENT_SEARCHES_STORAGE = 'musikat_recent_searches';
const MAX_RECENT_SEARCHES = 8;

function getRecentSearches() {
    try {
        const raw = localStorage.getItem(RECENT_SEARCHES_STORAGE);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.filter((s) => typeof s === 'string' && s.trim()) : [];
    } catch {
        return [];
    }
}

function addRecentSearch(query) {
    const q = query.trim();
    if (!q || isYouTubeUrl(q)) return;
    const list = getRecentSearches().filter((s) => s.toLowerCase() !== q.toLowerCase());
    list.unshift(q);
    try {
        localStorage.setItem(RECENT_SEARCHES_STORAGE, JSON.stringify(list.slice(0, MAX_RECENT_SEARCHES)));
    } catch { /* storage full/blocked — ignore */ }
}

function clearRecentSearches() {
    try { localStorage.removeItem(RECENT_SEARCHES_STORAGE); } catch { /* ignore */ }
    renderRecentSearches();
}

function renderRecentSearches() {
    const box = document.getElementById('recentSearches');
    if (!box) return;
    const list = getRecentSearches();
    if (!list.length || searchInput.value.trim()) {
        box.classList.add('hidden');
        box.innerHTML = '';
        return;
    }
    box.innerHTML =
        '<span class="recent-label">Recent:</span>' +
        list.map((q) => `<button type="button" class="recent-chip" data-recent="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('') +
        '<button type="button" class="recent-clear" title="Clear recent searches">Clear</button>';
    box.classList.remove('hidden');
}

function getMetadataProvider() {
    const el = document.getElementById('metadataProvider');
    return el && el.value ? el.value : 'deezer';
}

async function initMetadataProvider() {
    const el = document.getElementById('metadataProvider');
    if (!el) {
        setTimeout(initMetadataProvider, 100);
        return;
    }
    try {
        const r = await fetch(resolveAppUrl('api/metadata/providers'));
        if (!r.ok) return;
        const data = await r.json();
        const saved = localStorage.getItem(METADATA_PROVIDER_STORAGE);
        const def = data.default || 'deezer';
        el.innerHTML = (data.providers || []).map((p) => {
            const disabled = p.id === 'spotify' && !p.configured;
            const label = p.label || p.id;
            return `<option value="${p.id}" ${disabled ? 'disabled' : ''}>${escapeHtml(label)}${disabled ? ' (not configured)' : ''}</option>`;
        }).join('');
        const pick = saved && [...el.options].some((o) => o.value === saved && !o.disabled) ? saved : def;
        el.value = [...el.options].some((o) => o.value === pick && !o.disabled) ? pick : 'deezer';
        el.addEventListener('change', () => {
            localStorage.setItem(METADATA_PROVIDER_STORAGE, el.value);
        });
    } catch (e) {
        console.warn('metadata providers:', e);
    }
}

// DOM elements
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const loading = document.getElementById('loading');
const error = document.getElementById('error');
const results = document.getElementById('results');
const tracksList = document.getElementById('tracksList');
const albumsList = document.getElementById('albumsList');
const artistsList = document.getElementById('artistsList');
const downloadStatus = document.getElementById('downloadStatus');
const statusContent = document.getElementById('statusContent');

// Track download status tracking
const activeDownloads = new Map();
/** Last track + optional YouTube video id for the Retry button after a failed job */
const pendingRetryByTrackId = new Map();

function getDownloadMaxRetries() {
    const el = document.getElementById('autoRetryDownload');
    return el && el.checked ? 2 : 0;
}

/**
 * When nginx strips the path and does not send X-Forwarded-Prefix, __MUSIKAT_ROOT_PATH__ is empty
 * but the browser URL is still https://host/musikat/ — infer /musikat from pathname.
 */
function inferPathPrefixFromLocation() {
    let path = typeof window !== 'undefined' ? window.location.pathname || '' : '';
    if (!path || path === '/') return '';
    const trimmed = path.replace(/\/$/, '');
    const segments = trimmed.split('/').filter(Boolean);
    if (segments.length === 0) return '';
    const last = segments[segments.length - 1];
    if (last.includes('.') && !last.startsWith('.')) {
        segments.pop();
    }
    if (segments.length === 0) return '';
    return `/${segments[0]}`;
}

function getEffectiveRootPrefix() {
    const raw = typeof window !== 'undefined' ? window.__MUSIKAT_ROOT_PATH__ : undefined;
    if (raw != null && String(raw).trim() !== '') {
        return String(raw).replace(/\/$/, '');
    }
    return inferPathPrefixFromLocation();
}

/**
 * Resolve relative API paths to absolute URLs (localhost + reverse-proxy subpaths).
 */
function resolveAppUrl(relativeOrAbsolute) {
    if (!relativeOrAbsolute) return relativeOrAbsolute;
    if (/^https?:\/\//i.test(relativeOrAbsolute)) return relativeOrAbsolute;
    const root = getEffectiveRootPrefix();
    const path = relativeOrAbsolute.startsWith('/') ? relativeOrAbsolute : `/${relativeOrAbsolute}`;
    const fromPrefix = `${window.location.origin}${root}${path}`;
    if (root) return fromPrefix;
    try {
        const base =
            document.querySelector('base')?.href ||
            document.baseURI ||
            `${window.location.origin}${window.location.pathname.replace(/[^/]*$/, '')}`;
        return new URL(relativeOrAbsolute, base).href;
    } catch {
        return fromPrefix;
    }
}

/** @returns {{ location: string, navidromeLibrary: string|null }} */
function parseDownloadLocationValue(raw) {
    if (!raw || raw === 'local') return { location: 'local', navidromeLibrary: null };
    const s = String(raw);
    if (s.startsWith('navidrome:')) {
        const rest = s.slice('navidrome:'.length);
        try {
            const path = decodeURIComponent(rest);
            return { location: 'navidrome', navidromeLibrary: path || null };
        } catch {
            return { location: 'navidrome', navidromeLibrary: null };
        }
    }
    return { location: 'local', navidromeLibrary: null };
}

function getDownloadLocationPlace() {
    const el = document.getElementById('downloadLocation');
    return parseDownloadLocationValue(el && el.value);
}

function navidromeLibraryField(place) {
    const p = place || getDownloadLocationPlace();
    if (p.location === 'navidrome' && p.navidromeLibrary) {
        return { navidrome_library: p.navidromeLibrary };
    }
    return {};
}

function buildTrackExistsUrl(trackId) {
    const place = getDownloadLocationPlace();
    let url = `api/track/${encodeURIComponent(trackId)}/exists?provider=${encodeURIComponent(getMetadataProvider())}&location=${encodeURIComponent(place.location)}`;
    if (place.location === 'navidrome' && place.navidromeLibrary) {
        url += `&navidrome_library=${encodeURIComponent(place.navidromeLibrary)}`;
    }
    return resolveAppUrl(url);
}

function buildAlbumExistsUrl(albumId) {
    const place = getDownloadLocationPlace();
    let url = `api/album/${encodeURIComponent(albumId)}/exists?provider=${encodeURIComponent(getMetadataProvider())}&location=${encodeURIComponent(place.location)}`;
    if (place.location === 'navidrome' && place.navidromeLibrary) {
        url += `&navidrome_library=${encodeURIComponent(place.navidromeLibrary)}`;
    }
    return resolveAppUrl(url);
}

const ICON_DL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 20h14v-2H5v2zm7-3 7-7h-4V3H9v7H5l7 7z"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';

let lastSearchTracks = [];
let lastSearchAlbums = [];

let _downloadLocationRetryCount = 0;

async function loadDownloadLocations() {
    const sel = document.getElementById('downloadLocation');
    if (!sel) {
        _downloadLocationRetryCount += 1;
        if (_downloadLocationRetryCount < 80) {
            setTimeout(loadDownloadLocations, 100);
        } else {
            console.error('downloadLocation select not found after retries');
        }
        return;
    }
    _downloadLocationRetryCount = 0;

    if (!sel.dataset.changeBound) {
        sel.dataset.changeBound = '1';
        sel.addEventListener('change', refreshLibraryIndicatorsForCurrentView);
    }

    const applyLocalFallback = () => {
        sel.innerHTML =
            '<option value="local">My Downloads Folder (System)</option>';
        sel.value = 'local';
    };

    try {
        const url = resolveAppUrl('api/navidrome/libraries');
        const ac = new AbortController();
        const timeoutMs = 12000;
        const t = setTimeout(() => ac.abort(), timeoutMs);
        let r;
        try {
            r = await fetch(url, { signal: ac.signal, cache: 'no-store' });
        } finally {
            clearTimeout(t);
        }
        const opts = ['<option value="local">My Downloads Folder (System)</option>'];
        let libraries = [];
        if (r.ok) {
            try {
                const data = await r.json();
                libraries = data.libraries || [];
                libraries.forEach((lib) => {
                    const p = lib && lib.path != null ? String(lib.path) : '';
                    const v = `navidrome:${encodeURIComponent(p)}`;
                    const label = (lib && lib.label) || p || 'Library';
                    opts.push(
                        `<option value="${v.replace(/"/g, '&quot;')}">${escapeHtml(label)} — ${escapeHtml(p)}</option>`,
                    );
                });
            } catch (parseErr) {
                console.warn('navidrome libraries JSON:', parseErr);
            }
        } else {
            const errText = await r.text().catch(() => '');
            console.warn(
                'navidrome libraries request failed:',
                r.status,
                r.statusText,
                errText ? errText.slice(0, 200) : '',
            );
        }
        sel.innerHTML = opts.join('');
        if (libraries.length) {
            sel.value = `navidrome:${encodeURIComponent(libraries[0].path)}`;
        } else {
            sel.value = 'local';
        }
    } catch (e) {
        console.warn('navidrome libraries:', e);
        applyLocalFallback();
    }
}

// Search type: 'tracks', 'albums', or 'artists'
let searchType = 'tracks';

// Format and quality options (loaded on page init)
let availableFormats = [];
let availableQualities = [];
let defaultFormat = 'mp3';
let defaultQuality = '128';

// DOM elements for format/quality (will be set when DOM is ready)
let audioFormatSelect;
let audioQualitySelect;

// Load available formats and qualities on page load
async function loadFormatOptions() {
    // Get elements fresh each time in case DOM wasn't ready
    audioFormatSelect = document.getElementById('audioFormat');
    audioQualitySelect = document.getElementById('audioQuality');
    
    if (!audioFormatSelect || !audioQualitySelect) {
        console.error('Format/Quality select elements not found. Retrying in 100ms...');
        setTimeout(loadFormatOptions, 100);
        return;
    }
    
    try {
        const response = await fetch(resolveAppUrl('api/formats'));
        if (response.ok) {
            const data = await response.json();
            availableFormats = data.formats || [];
            availableQualities = data.qualities || [];
            defaultFormat = data.default_format || 'mp3';
            defaultQuality = data.default_quality || '128';
            
            // Populate format dropdown
            audioFormatSelect.innerHTML = availableFormats.map(fmt => 
                `<option value="${fmt.value}" ${fmt.value === defaultFormat ? 'selected' : ''}>${fmt.label} - ${fmt.description}</option>`
            ).join('');
            
            // Populate quality dropdown based on default format
            updateQualityOptions(defaultFormat);
            
            // Update quality options when format changes
            audioFormatSelect.addEventListener('change', (e) => {
                updateQualityOptions(e.target.value);
            });
        } else {
            const errorText = await response.text();
            console.error('Failed to load format options:', response.status, errorText);
            // Fallback to basic options
            audioFormatSelect.innerHTML = '<option value="mp3">MP3</option>';
            audioQualitySelect.innerHTML = '<option value="128">128 kbps</option>';
        }
    } catch (err) {
        console.error('Error loading format options:', err);
        // Fallback to basic options
        if (audioFormatSelect) audioFormatSelect.innerHTML = '<option value="mp3">MP3</option>';
        if (audioQualitySelect) audioQualitySelect.innerHTML = '<option value="128">128 kbps</option>';
    }
}

// Function to update quality options based on selected format
function updateQualityOptions(selectedFormat) {
    if (!audioQualitySelect) {
        audioQualitySelect = document.getElementById('audioQuality');
        if (!audioQualitySelect) return;
    }
    
    if (selectedFormat === 'flac') {
        // FLAC is lossless, only show lossless option
        audioQualitySelect.innerHTML = '<option value="lossless" selected>Lossless - No quality loss</option>';
    } else {
        // For lossy formats, show all quality options
        const currentQuality = audioQualitySelect.value || defaultQuality;
        audioQualitySelect.innerHTML = availableQualities
            .filter(qual => qual.value !== 'lossless') // Hide lossless for non-FLAC formats
            .map(qual => 
                `<option value="${qual.value}" ${qual.value === currentQuality ? 'selected' : ''}>${qual.label} - ${qual.description}</option>`
            ).join('');
    }
}

// Initialize on page load (wait for DOM to be ready)
function initializeFormatOptions() {
    const run = () => {
        loadFormatOptions();
        initMetadataProvider();
        loadDownloadLocations();
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        setTimeout(run, 50);
    }
}

initializeFormatOptions();

function setupMainTabs() {
    const tabSearch = document.getElementById('tabSearch');
    const tabSettings = document.getElementById('tabSettings');
    const panelSearch = document.getElementById('panelSearch');
    const panelSettings = document.getElementById('panelSettings');
    if (!tabSearch || !tabSettings || !panelSearch || !panelSettings) return;

    function showSearch() {
        panelSearch.classList.remove('hidden');
        panelSettings.classList.add('hidden');
        tabSearch.classList.add('active');
        tabSettings.classList.remove('active');
        tabSearch.setAttribute('aria-selected', 'true');
        tabSettings.setAttribute('aria-selected', 'false');
    }

    function showSettings() {
        panelSearch.classList.add('hidden');
        panelSettings.classList.remove('hidden');
        tabSearch.classList.remove('active');
        tabSettings.classList.add('active');
        tabSearch.setAttribute('aria-selected', 'false');
        tabSettings.setAttribute('aria-selected', 'true');
        loadDownloadLocations();
    }

    tabSearch.addEventListener('click', showSearch);
    tabSettings.addEventListener('click', showSettings);
}

setupMainTabs();

// ============ SEARCH UX (live search, keyboard nav, recents) ============

let searchDebounceTimer = null;
let searchAbortController = null;
let searchRequestSeq = 0;
const SEARCH_DEBOUNCE_MS = 350;

function cancelPendingSearch() {
    if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
    }
    if (searchAbortController) {
        searchAbortController.abort();
        searchAbortController = null;
    }
}

// Keyboard navigation state for result lists
let kbdIndex = -1;

function getVisibleResultCards() {
    const lists = [tracksList, albumsList, artistsList];
    for (const list of lists) {
        if (list && !list.classList.contains('hidden')) {
            return Array.from(list.querySelectorAll('.track-card, .album-card'));
        }
    }
    return [];
}

function resetKbdNav() {
    kbdIndex = -1;
    document.querySelectorAll('.kbd-active').forEach((el) => el.classList.remove('kbd-active'));
}

function moveKbdSelection(delta) {
    const cards = getVisibleResultCards();
    if (!cards.length) return;
    kbdIndex = (kbdIndex + delta + cards.length) % cards.length;
    cards.forEach((c, i) => c.classList.toggle('kbd-active', i === kbdIndex));
    cards[kbdIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function activateKbdSelection() {
    const cards = getVisibleResultCards();
    if (kbdIndex < 0 || kbdIndex >= cards.length) return false;
    const card = cards[kbdIndex];
    // Track card: trigger its download button if present and enabled
    const dlTrack = card.querySelector('[data-download-track]');
    if (dlTrack && !dlTrack.disabled) {
        dlTrack.click();
        return true;
    }
    // Album card: explicit download button first, otherwise open details
    const dlAlbum = card.querySelector('[data-download-album]');
    if (dlAlbum && !dlAlbum.disabled && !dlAlbum.hidden) {
        dlAlbum.click();
        return true;
    }
    if (card.dataset.albumId) {
        showAlbumDetails(card.dataset.albumId);
        return true;
    }
    if (card.dataset.artistId) {
        showArtistAlbums(card.dataset.artistId);
        return true;
    }
    return false;
}

// Event listeners
searchBtn.addEventListener('click', () => {
    cancelPendingSearch();
    resetKbdNav();
    handleSearch();
});

searchInput.addEventListener('input', () => {
    resetKbdNav();
    const query = searchInput.value.trim();
    cancelPendingSearch();
    if (!query) {
        hideError();
        hideLoading();
        renderRecentSearches();
        return;
    }
    document.getElementById('recentSearches')?.classList.add('hidden');
    searchDebounceTimer = setTimeout(() => {
        searchDebounceTimer = null;
        handleSearch();
    }, SEARCH_DEBOUNCE_MS);
});

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveKbdSelection(1);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveKbdSelection(-1);
    } else if (e.key === 'Enter') {
        if (activateKbdSelection()) {
            e.preventDefault();
            return;
        }
        cancelPendingSearch();
        handleSearch();
    } else if (e.key === 'Escape') {
        resetKbdNav();
        searchInput.blur();
    }
});

searchInput.addEventListener('focus', renderRecentSearches);
searchInput.addEventListener('blur', () => {
    // Delay so a chip click still registers before the box hides
    setTimeout(() => document.getElementById('recentSearches')?.classList.add('hidden'), 150);
});

document.getElementById('recentSearches')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-recent]');
    if (chip) {
        searchInput.value = chip.getAttribute('data-recent');
        document.getElementById('recentSearches').classList.add('hidden');
        cancelPendingSearch();
        handleSearch();
        return;
    }
    if (e.target.closest('.recent-clear')) {
        clearRecentSearches();
    }
});

function setSearchType(type) {
    searchType = type;
    document.getElementById('searchTracks')?.classList.toggle('active', type === 'tracks');
    document.getElementById('searchAlbums')?.classList.toggle('active', type === 'albums');
    document.getElementById('searchArtists')?.classList.toggle('active', type === 'artists');
    if (searchInput.value.trim()) handleSearch();
}

document.getElementById('searchTypeToggle')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-search-type]');
    if (btn) setSearchType(btn.getAttribute('data-search-type'));
});

artistsList?.addEventListener('click', (e) => {
    const card = e.target.closest('[data-artist-id]');
    if (card) showArtistAlbums(card.getAttribute('data-artist-id'));
});

tracksList?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-download-track]');
    if (!btn || btn.disabled) return;
    const id = btn.getAttribute('data-download-track');
    const track = lastSearchTracks.find((t) => String(t.id) === String(id));
    if (track) downloadTrack(track);
});

albumsList?.addEventListener('click', (e) => {
    const dl = e.target.closest('[data-download-album]');
    if (dl) {
        e.preventDefault();
        e.stopPropagation();
        if (!dl.disabled) startAlbumDownload({ id: dl.getAttribute('data-download-album') });
        return;
    }
    const card = e.target.closest('[data-album-id]');
    if (card) showAlbumDetails(card.getAttribute('data-album-id'));
});

async function handleSearch() {
    const query = searchInput.value.trim();

    if (!query) {
        showError('Please enter a search query');
        return;
    }

    cancelPendingSearch();
    const controller = new AbortController();
    searchAbortController = controller;
    const seq = ++searchRequestSeq;
    const isStale = () => controller.signal.aborted || seq !== searchRequestSeq;

    // Reverse flow: YouTube / YouTube Music URL pasted into search box
    if (isYouTubeUrl(query)) {
        hideError();
        showLoading();
        hideResults();
        hideReverseResults();
        clearArtistHeader();

        try {
            const data = await reverseLookupYouTube(query, controller.signal);
            if (isStale()) return;
            hideLoading();
            showReverseResults(data);
            return;
        } catch (err) {
            if (isStale()) return;
            hideLoading();
            showError(`Reverse lookup failed: ${err.message}`);
            return;
        }
    }

    hideError();
    showLoading();
    hideResults();
    hideReverseResults();
    clearArtistHeader();

    try {
        if (searchType === 'albums') {
            const albums = await searchAlbums(query, controller.signal);
            if (isStale()) return;
            displayAlbums(albums);
        } else if (searchType === 'artists') {
            const artists = await searchArtists(query, controller.signal);
            if (isStale()) return;
            displayArtists(artists);
        } else {
            const tracks = await searchTracks(query, controller.signal);
            if (isStale()) return;
            await displayTracks(tracks);
        }
        if (isStale()) return;
        addRecentSearch(query);
        hideLoading();
        showResults();
    } catch (err) {
        if (isStale()) return;
        hideLoading();
        showError(`Search failed: ${err.message}`);
    }
}

async function searchTracks(query, signal) {
    const response = await fetch(resolveAppUrl('api/search'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, limit: 20, provider: getMetadataProvider() }),
        signal,
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Search failed');
    }
    
    return await response.json();
}

// ============ REVERSE (YouTube -> Spotify) ============

let reverseState = {
    youtubeUrl: null,
    youtubeInfo: null,
    selectedSpotifyTrackId: null,
    manualMetadata: null,
};

function isYouTubeUrl(input) {
    try {
        const u = new URL(input);
        const host = u.hostname.toLowerCase();
        return host === 'www.youtube.com' || host === 'youtube.com' || host === 'music.youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
    } catch {
        return false;
    }
}

async function reverseLookupYouTube(url, signal) {
    const response = await fetch(resolveAppUrl('api/reverse/youtube'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, provider: getMetadataProvider() }),
        signal,
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Reverse lookup failed');
    }

    return await response.json();
}

function hideReverseResults() {
    document.getElementById('reverseResults')?.classList.add('hidden');
}

function showReverseResults(data) {
    const reverseResults = document.getElementById('reverseResults');
    const ytInfoDiv = document.getElementById('reverseYouTubeInfo');
    const spList = document.getElementById('reverseSpotifyList');
    const manualBtn = document.getElementById('reverseManualBtn');
    const manualForm = document.getElementById('reverseManualForm');
    const finalize = document.getElementById('reverseFinalize');
    const selectedLabel = document.getElementById('reverseSelectedLabel');

    if (!reverseResults || !ytInfoDiv || !spList) return;

    reverseState = {
        youtubeUrl: data?.youtube?.webpage_url || null,
        youtubeInfo: data?.youtube || null,
        selectedSpotifyTrackId: null,
        manualMetadata: null,
    };

    // Normalize youtube url
    reverseState.youtubeUrl = data?.youtube?.webpage_url || null;
    if (!reverseState.youtubeUrl && reverseState.youtubeInfo?.video_id) {
        reverseState.youtubeUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(reverseState.youtubeInfo.video_id)}`;
    }

    const ytTitle = escapeHtml(data?.youtube?.title || '');
    const ytUploader = escapeHtml(data?.youtube?.uploader || '');
    const ytUrl = data?.youtube?.webpage_url || reverseState.youtubeUrl;
    const ytThumb = data?.youtube?.thumbnail || '';

    ytInfoDiv.innerHTML = `
        <div><strong>YouTube title:</strong> ${ytTitle}</div>
        <div><strong>Channel:</strong> ${ytUploader}</div>
        <div><strong>URL:</strong> <a href="${ytUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(ytUrl)}</a></div>
        <div><strong>Search query:</strong> ${escapeHtml(data?.query || '')}</div>
        ${ytThumb ? `<div style="margin-top:10px;"><img src="${ytThumb}" alt="thumbnail" style="max-width:180px;border-radius:10px;border:1px solid var(--border-color);"/></div>` : ''}
    `;

    const candidates = data?.spotify_candidates || [];
    if (!candidates.length) {
        spList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No matches found. Use manual metadata.</p>';
    } else {
        spList.innerHTML = candidates.map(track => `
            <div class="track-card">
                <img src="${track.album_art || 'https://via.placeholder.com/80?text=No+Image'}" alt="${escapeHtml(track.album)}" class="track-art" />
                <div class="track-info">
                    <div class="track-name">${escapeHtml(track.name)}</div>
                    <div class="track-artist">${escapeHtml(track.artist)}</div>
                    <div class="track-album">${escapeHtml(track.album)} • ${formatDuration(track.duration_ms)}</div>
                </div>
                <div class="track-actions">
                    <button class="btn btn-download" data-spotify-track-id="${track.id}">Select</button>
                </div>
            </div>
        `).join('');

        spList.querySelectorAll('button[data-spotify-track-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const trackId = btn.dataset.spotifyTrackId;
                reverseState.selectedSpotifyTrackId = trackId;
                reverseState.manualMetadata = null;
                manualForm?.classList.add('hidden');
                finalize?.classList.remove('hidden');
                if (selectedLabel) selectedLabel.textContent = `Selected track: ${trackId}`;
            });
        });
    }

    manualBtn?.addEventListener('click', () => {
        manualForm?.classList.toggle('hidden');
    });

    document.getElementById('reverseUseManual')?.addEventListener('click', () => {
        const artist = document.getElementById('manualArtist')?.value?.trim() || '';
        const name = document.getElementById('manualName')?.value?.trim() || '';
        const albumArtist = document.getElementById('manualAlbumArtist')?.value?.trim() || '';
        const album = document.getElementById('manualAlbum')?.value?.trim() || '';
        const trackNumber = document.getElementById('manualTrackNumber')?.value?.trim() || '';
        const releaseDate = document.getElementById('manualReleaseDate')?.value?.trim() || '';

        if (!artist || !name) {
            showError('Manual metadata requires Artist and Song title');
            return;
        }

        reverseState.manualMetadata = {
            artist,
            name,
            album_artist: albumArtist,
            album,
            track_number: trackNumber ? Number(trackNumber) : 1,
            release_date: releaseDate,
        };
        reverseState.selectedSpotifyTrackId = null;
        finalize?.classList.remove('hidden');
        if (selectedLabel) selectedLabel.textContent = `Using manual metadata: ${artist} - ${name}`;
    });

    document.getElementById('reverseDownloadBtn')?.addEventListener('click', () => {
        startReverseDownload();
    });

    reverseResults.classList.remove('hidden');
}

async function startReverseDownload() {
    const youtubeUrl = reverseState.youtubeUrl || reverseState.youtubeInfo?.webpage_url;
    if (!youtubeUrl) {
        showError('Missing YouTube URL');
        return;
    }

    const place = getDownloadLocationPlace();

    // Ensure one source of metadata
    if (!reverseState.selectedSpotifyTrackId && !reverseState.manualMetadata) {
        showError('Select a track or use manual metadata first');
        return;
    }

    const payload = {
        youtube_url: youtubeUrl,
        location: place.location,
        spotify_track_id: reverseState.selectedSpotifyTrackId,
        metadata: reverseState.manualMetadata,
        provider: getMetadataProvider(),
        ...navidromeLibraryField(place),
    };

    // Mark as downloading using synthetic id returned by API
    try {
        showDownloadStatus();
        const response = await fetch(resolveAppUrl('api/reverse/download'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Reverse download failed');
        }

        const result = await response.json();
        const jobId = result.job_id;

        const trackLike = {
            id: jobId,
            name: reverseState.manualMetadata?.name || reverseState.youtubeInfo?.title || 'YouTube download',
            artist: reverseState.manualMetadata?.artist || reverseState.youtubeInfo?.uploader || '',
            album: reverseState.manualMetadata?.album || '',
            album_art: null,
        };

        activeDownloads.set(jobId, { status: 'queued', progress: 0, track: trackLike });
        addStatusItem(jobId, trackLike, 'queued', 'Reverse download queued...', 0);
        showToast(`Queued: ${trackLike.name}`, 'info');
        pollDownloadStatus(jobId, trackLike);

    } catch (err) {
        showError(err.message || String(err));
    }
}

async function searchAlbums(query, signal) {
    const response = await fetch(resolveAppUrl('api/search/albums'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, limit: 20, provider: getMetadataProvider() }),
        signal,
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Album search failed');
    }
    
    return await response.json();
}

async function searchArtists(query, signal) {
    const response = await fetch(resolveAppUrl('api/search/artists'), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, limit: 20, provider: getMetadataProvider() }),
        signal,
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Artist search failed');
    }

    return await response.json();
}

async function displayTracks(tracks) {
    // Show tracks list, hide albums list
    tracksList.classList.remove('hidden');
    albumsList.classList.add('hidden');
    artistsList?.classList.add('hidden');
    clearArtistHeader();
    resetKbdNav();

    if (tracks.length === 0) {
        tracksList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No tracks found. Try artist + title, or the other catalog.</p>';
        return;
    }

    lastSearchTracks = tracks;
    // Render immediately, then mark "in library" state in a single batch request
    tracksList.innerHTML = tracks.map(track => createTrackCard(track, false)).join('');
    await refreshTrackLibraryMarks(tracks);
}

/** Batch library check. Returns a Set of owned track ids, or null if the batch endpoint failed. */
async function batchCheckTracksExist(tracks) {
    try {
        const place = getDownloadLocationPlace();
        const response = await fetch(resolveAppUrl('api/tracks/exists'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tracks: tracks.map((t) => ({ id: String(t.id), name: t.name, artist: t.artist, album: t.album })),
                location: place.location,
                provider: getMetadataProvider(),
                ...(place.location === 'navidrome' && place.navidromeLibrary
                    ? { navidrome_library: place.navidromeLibrary }
                    : {}),
            }),
        });
        if (!response.ok) return null;
        const data = await response.json();
        const results = data.results || {};
        return new Set(Object.keys(results).filter((id) => results[id]));
    } catch (err) {
        return null;
    }
}

/** Re-run "in library" indicators for whatever is currently shown (e.g. after switching Download to). */
function refreshLibraryIndicatorsForCurrentView() {
    if (!tracksList.classList.contains('hidden') && lastSearchTracks.length) {
        displayTracks(lastSearchTracks);
    } else if (!albumsList.classList.contains('hidden') && lastSearchAlbums.length) {
        displayAlbums(lastSearchAlbums);
    }
    const albumModalEl = document.getElementById('albumModal');
    if (albumModalEl && !albumModalEl.classList.contains('hidden') && currentAlbum) {
        refreshAlbumModalLibrary(currentAlbum);
    }
}

async function refreshTrackLibraryMarks(tracks) {
    let owned = await batchCheckTracksExist(tracks);

    if (owned === null) {
        // Fallback: per-track checks (older server without the batch endpoint)
        owned = new Set();
        await Promise.all(tracks.map(async (track) => {
            try {
                const response = await fetch(buildTrackExistsUrl(track.id));
                if (response.ok) {
                    const data = await response.json();
                    if (data.exists) owned.add(String(track.id));
                }
            } catch (err) {
                // Silently fail - just won't show as downloaded
            }
        }));
    }

    owned.forEach((id) => updateTrackToDownloaded(id));
}

function createTrackCard(track, isDownloaded = false) {
    const albumArt = track.album_art || 'https://via.placeholder.com/80?text=No+Image';
    const duration = formatDuration(track.duration_ms);
    const isDownloading = activeDownloads.has(track.id);
    const ownedClass = isDownloaded ? ' is-owned' : '';
    const action = isDownloaded
        ? `<span class="in-library-mark" title="In library">${ICON_CHECK}<span>In library</span></span>`
        : `<button type="button" class="icon-dl" data-download-track="${escapeHtml(String(track.id))}" ${isDownloading ? 'disabled' : ''} aria-label="Download ${escapeHtml(track.name)}">${ICON_DL}</button>`;

    return `
        <div class="track-card${ownedClass}" data-track-id="${escapeHtml(String(track.id))}">
            <div class="media-art">
                <img src="${albumArt}" alt="${escapeHtml(track.album || '')}" class="track-art" />
                ${isDownloaded ? `<span class="art-check">${ICON_CHECK}</span>` : ''}
            </div>
            <div class="track-info">
                <div class="track-name">${escapeHtml(track.name)}</div>
                <div class="track-artist">${escapeHtml(track.artist)}</div>
                <div class="track-album">${escapeHtml(track.album)} • ${duration}</div>
            </div>
            <div class="track-actions">${action}</div>
        </div>
    `;
}

async function downloadTrack(track, selectedVideoId = null) {
    const trackId = track.id;

    const place = getDownloadLocationPlace();

    // If no video selected, first check if we need user confirmation
    if (!selectedVideoId) {
        try {
            updateDownloadButton(trackId, true);
            console.log('Fetching YouTube candidates for:', trackId);
            const candidatesResponse = await fetch(
                resolveAppUrl(`api/youtube/candidates/${encodeURIComponent(trackId)}?provider=${encodeURIComponent(getMetadataProvider())}`),
            );
            
            if (candidatesResponse.ok) {
                const data = await candidatesResponse.json();
                console.log('Candidates response:', data);
                
                // If confidence is low, show candidate selection modal
                if (data.needs_confirmation && data.candidates && data.candidates.length > 0) {
                    console.log('Low confidence, showing modal. Best score:', data.best_score);
                    updateDownloadButton(trackId, false);
                    showCandidateModal(track, data.candidates, document.getElementById('downloadLocation').value);
                    return;
                }
                
                // High confidence - use best match's video ID
                if (data.candidates && data.candidates.length > 0) {
                    console.log('High confidence, auto-selecting:', data.candidates[0].title);
                    selectedVideoId = data.candidates[0].video_id;
                }
            } else {
                // If candidates endpoint failed, try to get error message
                let errorMsg = 'Failed to search YouTube';
                try {
                    const errorData = await candidatesResponse.json();
                    errorMsg = errorData.detail || errorMsg;
                } catch (e) {
                    // If we can't parse error, use default message
                }
                
                console.error('Candidates fetch failed:', candidatesResponse.status, errorMsg);
                
                // Show error to user and don't proceed with download
                showError(`Cannot search YouTube: ${errorMsg}. This may be due to YouTube blocking requests (403). Please configure YouTube cookies (see documentation) or try again later.`);
                updateDownloadButton(trackId, false);
                return;
            }
        } catch (err) {
            console.error('Candidate check failed:', err);
            showError(`Failed to check YouTube candidates: ${err.message}. Please try again or configure YouTube cookies.`);
            updateDownloadButton(trackId, false);
            return;
        }
    }
    
    // Mark as downloading
    activeDownloads.set(trackId, { status: 'queued', progress: 0, track: track });
    updateDownloadButton(trackId, true);
    
    try {
        // Show download status section
        showDownloadStatus();
        addStatusItem(trackId, track, 'queued', 'Download queued...', 0);
        
        // Get format and quality preferences
        const formatSelect = document.getElementById('audioFormat');
        const qualitySelect = document.getElementById('audioQuality');
        const format = (formatSelect && formatSelect.value) ? formatSelect.value : defaultFormat;
        const quality = (qualitySelect && qualitySelect.value) ? qualitySelect.value : defaultQuality;
        
        // Start download
        pendingRetryByTrackId.set(trackId, { track, videoId: selectedVideoId || null });
        const response = await fetch(resolveAppUrl('api/download'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                track_id: trackId,
                location: place.location,
                video_id: selectedVideoId,
                format: format,
                quality: quality,
                provider: getMetadataProvider(),
                max_retries: getDownloadMaxRetries(),
                ...navidromeLibraryField(place),
            }),
        });
        
        if (!response.ok) {
            pendingRetryByTrackId.delete(trackId);
            const error = await response.json().catch(() => ({}));
            const msg = error.detail || 'Download failed';
            throw new Error(msg);
        }
        
        // Poll for status updates
        pollDownloadStatus(trackId, track);
        
    } catch (err) {
        pendingRetryByTrackId.delete(trackId);
        updateDownloadButton(trackId, false);
        activeDownloads.delete(trackId);
        const msg = err.message || String(err);
        if (msg.includes('already in your library')) {
            // Server-side duplicate guard caught it — just mark it as owned
            updateTrackToDownloaded(trackId);
            showToast(msg, 'info');
        } else {
            showError(msg);
        }
    }
}

// Candidate selection modal
let pendingTrack = null;
let pendingLocation = null;

function getYouTubeUrl(videoId, source = 'yt-dlp') {
    const baseUrl = source === 'ytmusic' ? 'https://music.youtube.com' : 'https://www.youtube.com';
    return `${baseUrl}/watch?v=${encodeURIComponent(videoId)}`;
}

const EXTERNAL_LINK_SVG = `
<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3z"></path>
  <path d="M5 5h6v2H7v10h10v-4h2v6H5V5z"></path>
</svg>`;

function showCandidateModal(track, candidates, location) {
    pendingTrack = track;
    pendingLocation = location;
    
    const modal = document.getElementById('candidateModal');
    const trackInfoDisplay = document.getElementById('trackInfoDisplay');
    const candidatesList = document.getElementById('candidatesList');
    
    // Show track info
    trackInfoDisplay.innerHTML = `
        <div class="looking-for">
            <strong>Looking for:</strong> ${escapeHtml(track.name)} by ${escapeHtml(track.artist)}
        </div>
    `;
    
    // Show candidates
    candidatesList.innerHTML = candidates.map((candidate) => `
        <div class="candidate-card" data-video-id="${candidate.video_id}">
            <div class="candidate-info">
                <div class="candidate-title-row">
                    <div class="candidate-title">${escapeHtml(candidate.title)}</div>
                    <a
                        class="candidate-external"
                        href="${getYouTubeUrl(candidate.video_id, candidate.source)}"
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open on YouTube"
                        aria-label="Open on YouTube"
                    >${EXTERNAL_LINK_SVG}</a>
                </div>
                <div class="candidate-channel">${escapeHtml(candidate.channel)}</div>
                <div class="candidate-meta">
                    <span class="candidate-duration">${formatDuration(candidate.duration * 1000)}</span>
                    <span class="candidate-score ${getScoreClass(candidate.score)}">${Math.round(candidate.score * 100)}% match</span>
                </div>
            </div>
            <button class="btn btn-download candidate-select" data-video-id="${candidate.video_id}">
                Select
            </button>
        </div>
    `).join('');
    
    // Add click handlers
    candidatesList.querySelectorAll('.candidate-select').forEach(btn => {
        btn.addEventListener('click', () => {
            const videoId = btn.dataset.videoId;
            const trackToDownload = pendingTrack;
            const locationToUse = pendingLocation;
            hideCandidateModal();
            // Preserve the user's chosen location from when they clicked Download
            if (locationToUse) {
                const locationSelect = document.getElementById('downloadLocation');
                if (locationSelect) locationSelect.value = locationToUse;
            }
            downloadTrack(trackToDownload, videoId);
        });
    });
    
    modal.classList.remove('hidden');
}

function hideCandidateModal() {
    const modal = document.getElementById('candidateModal');
    modal.classList.add('hidden');
    pendingTrack = null;
    pendingLocation = null;
}

function getScoreClass(score) {
    if (score >= 0.8) return 'score-high';
    if (score >= 0.5) return 'score-medium';
    return 'score-low';
}

// Modal event listeners
document.getElementById('modalClose')?.addEventListener('click', hideCandidateModal);
document.getElementById('cancelSelection')?.addEventListener('click', hideCandidateModal);
document.getElementById('candidateModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'candidateModal') hideCandidateModal();
});

/** Only one status poller per track id (avoids parallel loops each firing a file download). */
const pollDownloadActiveForTrack = new Set();

/**
 * Single GET for temp file, then save via blob URL — avoids extra browser navigation/prefetch
 * hits to the same URL after the server deletes the temp file (which caused 404 spam).
 */
const localFileFetchInFlight = new Set();

async function fetchLocalTrackFileOnce(trackId, downloadUrl, filePath) {
    if (localFileFetchInFlight.has(trackId)) return false;
    localFileFetchInFlight.add(trackId);
    const release = () => {
        setTimeout(() => localFileFetchInFlight.delete(trackId), 3000);
    };
    try {
        const url = resolveAppUrl(downloadUrl);
        const r = await fetch(url, { credentials: 'same-origin' });
        if (!r.ok) {
            release();
            const msg = `File download failed (${r.status})`;
            showError(msg);
            return false;
        }
        const blob = await r.blob();
        const fname = (filePath && filePath.split('/').pop()) || 'download.mp3';
        const objUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objUrl;
        link.download = fname;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(objUrl), 120000);
        release();
        return true;
    } catch (err) {
        localFileFetchInFlight.delete(trackId);
        showError(err.message || String(err));
        return false;
    }
}

/**
 * Poll download job status. Chained timeouts + one poller per track + single file fetch.
 */
function attachRetryButton(trackId, track) {
    const statusItem = document.getElementById(`status-${trackId}`);
    if (!statusItem) return;
    const existing = statusItem.querySelector('.status-actions');
    if (existing) existing.remove();
    const row = document.createElement('div');
    row.className = 'status-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-retry';
    btn.textContent = 'Retry';
    btn.addEventListener('click', () => {
        const d = pendingRetryByTrackId.get(trackId);
        if (d && d.track) {
            downloadTrack(d.track, d.videoId);
        } else if (track) {
            downloadTrack(track, null);
        }
    });
    row.appendChild(btn);
    statusItem.appendChild(row);
}

function pollDownloadStatus(trackId, track) {
    if (pollDownloadActiveForTrack.has(trackId)) {
        return;
    }
    pollDownloadActiveForTrack.add(trackId);

    const POLL_MS = 2000;
    let stopped = false;

    const finishPoll = () => {
        pollDownloadActiveForTrack.delete(trackId);
    };

    const finishError = (msg) => {
        stopped = true;
        finishPoll();
        updateStatusItem(trackId, 'error', msg);
        attachRetryButton(trackId, track);
        updateDownloadButton(trackId, false);
        activeDownloads.delete(trackId);
        showToast(`${track.name || 'Track'}: ${msg}`, 'error', 6000);
    };

    const tick = async () => {
        if (stopped) return;
        try {
            const response = await fetch(resolveAppUrl(`api/download/status/${encodeURIComponent(trackId)}`));

            if (!response.ok) {
                finishError('Failed to check status');
                return;
            }

            const status = await response.json();
            status.track = track;
            activeDownloads.set(trackId, status);

            const progress = status.progress !== undefined ? status.progress : getProgressFromStatus(status.status, status.message);
            updateStatusItem(trackId, status.status, status.message, progress);

                if (status.status === 'completed' || status.status === 'error') {
                stopped = true;
                updateDownloadButton(trackId, false);
                updateQueueCount();

                if (status.status === 'completed') {
                    pendingRetryByTrackId.delete(trackId);
                    updateTrackToDownloaded(trackId);
                    // Keep the album card's "x/y in library" indicator in sync
                    if (track.album_id) refreshAlbumLibraryStatus(track.album_id);
                    if (currentAlbum && String(currentAlbum.id) === String(track.album_id)) {
                        refreshAlbumModalLibrary(currentAlbum);
                    }
                    showToast(`Downloaded: ${track.name || 'track'}`, 'success');
                    if (status.download_url) {
                        const ok = await fetchLocalTrackFileOnce(trackId, status.download_url, status.file_path);
                        if (ok) {
                            updateStatusItem(trackId, 'completed', 'Download started - check your Downloads folder', 100);
                        } else {
                            updateStatusItem(trackId, 'error', 'Could not fetch the file from the server');
                            attachRetryButton(trackId, track);
                        }
                    }

                    setTimeout(() => {
                        removeStatusItem(trackId);
                        activeDownloads.delete(trackId);
                        finishPoll();
                    }, 5000);
                } else {
                    attachRetryButton(trackId, track);
                    activeDownloads.delete(trackId);
                    finishPoll();
                    showToast(`Failed: ${track.name || 'track'} — ${status.message || 'error'}`, 'error', 6000);
                }
                return;
            }

            updateQueueCount();
            setTimeout(tick, POLL_MS);
        } catch (err) {
            finishError(`Error: ${err.message}`);
        }
    };

    setTimeout(tick, POLL_MS);
}

function addStatusItem(trackId, track, status, message, progress = 0) {
    // Remove existing item if present
    const existing = document.getElementById(`status-${trackId}`);
    if (existing) {
        existing.remove();
    }
    
    const statusItem = document.createElement('div');
    statusItem.id = `status-${trackId}`;
    statusItem.className = `status-item status-${status}`;
    
    const progressBar = status === 'completed' || status === 'error' ? '' : `
        <div class="progress-bar-container">
            <div class="progress-bar" style="width: ${progress}%"></div>
        </div>
    `;
    
    const albumArt = track.album_art || 'https://via.placeholder.com/50?text=No+Image';
    
    statusItem.innerHTML = `
        <div class="status-item-header">
            <img src="${albumArt}" alt="${track.album}" class="status-art" />
            <div class="status-item-info">
                <h3>${escapeHtml(track.name)}</h3>
                <p class="status-artist">${escapeHtml(track.artist)}</p>
            </div>
            <div class="status-badge status-badge-${status}">${getStatusLabel(status)}</div>
        </div>
        <p class="status-message">${escapeHtml(message)}</p>
        ${progressBar}
    `;
    statusContent.appendChild(statusItem);
}

function updateStatusItem(trackId, status, message, progress = 0) {
    const statusItem = document.getElementById(`status-${trackId}`);
    if (statusItem) {
        statusItem.className = `status-item status-${status}`;
        
        // Update message
        const messageP = statusItem.querySelector('.status-message');
        if (messageP) {
            messageP.textContent = message;
        }
        
        // Update status badge
        const badge = statusItem.querySelector('.status-badge');
        if (badge) {
            badge.className = `status-badge status-badge-${status}`;
            badge.textContent = getStatusLabel(status);
        }
        
        // Update progress bar
        const progressBar = statusItem.querySelector('.progress-bar');
        if (progressBar) {
            progressBar.style.width = `${progress}%`;
        } else if (status !== 'completed' && status !== 'error') {
            // Add progress bar if it doesn't exist
            const progressContainer = document.createElement('div');
            progressContainer.className = 'progress-bar-container';
            progressContainer.innerHTML = `<div class="progress-bar" style="width: ${progress}%"></div>`;
            statusItem.appendChild(progressContainer);
        }
    }
}

function getStatusLabel(status) {
    const labels = {
        'queued': 'Queued',
        'processing': 'Processing',
        'completed': 'Completed',
        'error': 'Error'
    };
    return labels[status] || status;
}

function getProgressFromStatus(status, message) {
    if (status === 'completed') return 100;
    if (status === 'error') return 0;
    if (status === 'queued') return 0;
    
    // Estimate progress based on message
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('fetching') || lowerMessage.includes('fetch')) return 10;
    if (lowerMessage.includes('preparing')) return 15;
    if (lowerMessage.includes('searching') || lowerMessage.includes('downloading') || lowerMessage.includes('download')) return 50;
    if (lowerMessage.includes('metadata') || lowerMessage.includes('applying') || lowerMessage.includes('tagging')) return 85;
    if (lowerMessage.includes('copying') || lowerMessage.includes('navidrome')) return 90;
    
    return 30; // Default progress for processing
}

function removeStatusItem(trackId) {
    pendingRetryByTrackId.delete(trackId);
    const statusItem = document.getElementById(`status-${trackId}`);
    if (statusItem) {
        statusItem.remove();
        
        // Hide status section if no items left
        if (statusContent.children.length === 0) {
            hideDownloadStatus();
        }
    }
}

function updateDownloadButton(trackId, downloading) {
    document.querySelectorAll(`[data-download-track="${CSS.escape(String(trackId))}"]`).forEach((button) => {
        button.disabled = downloading;
        button.setAttribute('aria-busy', downloading ? 'true' : 'false');
    });
}

function updateTrackToDownloaded(trackId) {
    const card = document.querySelector(`.track-card[data-track-id="${CSS.escape(String(trackId))}"]`);
    if (card) {
        card.classList.add('is-owned');
        const art = card.querySelector('.media-art');
        if (art && !art.querySelector('.art-check')) {
            art.insertAdjacentHTML('beforeend', `<span class="art-check">${ICON_CHECK}</span>`);
        }
        const actionsDiv = card.querySelector('.track-actions');
        if (actionsDiv) {
            actionsDiv.innerHTML = `<span class="in-library-mark" title="In library">${ICON_CHECK}<span>In library</span></span>`;
        }
    }
    const row = document.querySelector(`.album-track[data-track-id="${CSS.escape(String(trackId))}"]`);
    if (row) {
        row.classList.add('is-owned');
        const actions = row.querySelector('.album-track-actions');
        if (actions) {
            actions.innerHTML = `<span class="in-library-mark" title="In library">${ICON_CHECK}</span>`;
        }
    }
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function showLoading() {
    loading.classList.remove('hidden');
}

function hideLoading() {
    loading.classList.add('hidden');
}

function showError(message) {
    error.textContent = message;
    error.classList.remove('hidden');
    showToast(message, 'error', 6000);
}

function hideError() {
    error.classList.add('hidden');
}

function showResults() {
    results.classList.remove('hidden');
}

function hideResults() {
    results.classList.add('hidden');
}

const QUEUE_MINIMIZED_STORAGE = 'musikat_queue_minimized';
let queueMinimized = localStorage.getItem(QUEUE_MINIMIZED_STORAGE) === '1';

function showDownloadStatus() {
    const fab = document.getElementById('queueFab');
    if (queueMinimized) {
        downloadStatus.classList.add('hidden');
        fab?.classList.remove('hidden');
    } else {
        downloadStatus.classList.remove('hidden');
        fab?.classList.add('hidden');
    }
    updateQueueCount();
}

function hideDownloadStatus() {
    downloadStatus.classList.add('hidden');
    document.getElementById('queueFab')?.classList.add('hidden');
}

function minimizeQueue() {
    queueMinimized = true;
    localStorage.setItem(QUEUE_MINIMIZED_STORAGE, '1');
    showDownloadStatus();
}

function expandQueue() {
    queueMinimized = false;
    localStorage.setItem(QUEUE_MINIMIZED_STORAGE, '0');
    showDownloadStatus();
}

function clearFinishedQueueItems() {
    statusContent.querySelectorAll('.status-completed, .status-error').forEach((item) => {
        const id = item.id.replace(/^status-/, '');
        pendingRetryByTrackId.delete(id);
        activeDownloads.delete(id);
        item.remove();
    });
    if (statusContent.children.length === 0) {
        hideDownloadStatus();
    }
    updateQueueCount();
}

function updateQueueCount() {
    const queueCount = document.getElementById('queueCount');
    const activeTracks = Array.from(activeDownloads.values()).filter(s => s.status !== 'completed' && s.status !== 'error').length;
    const activeCount = activeTracks + albumPollActive.size;
    if (queueCount) {
        queueCount.textContent = activeCount > 0 ? `(${activeCount} active)` : '';
    }

    // FAB badge: active count, red when only errors remain
    const badge = document.getElementById('queueFabBadge');
    const errorCount = statusContent.querySelectorAll('.status-error').length;
    if (badge) {
        if (activeCount > 0 || errorCount > 0) {
            badge.classList.remove('hidden');
            badge.textContent = activeCount > 0 ? String(activeCount) : String(errorCount);
            badge.classList.toggle('queue-fab-badge--error', errorCount > 0 && activeCount === 0);
        } else {
            badge.classList.add('hidden');
        }
    }
}

document.getElementById('queueFab')?.addEventListener('click', expandQueue);
document.getElementById('queueMinimize')?.addEventListener('click', minimizeQueue);
document.getElementById('queueClearDone')?.addEventListener('click', clearFinishedQueueItems);

// ============ ALBUM FUNCTIONS ============

function displayAlbums(albums) {
    // Show albums list, hide tracks list
    albumsList.classList.remove('hidden');
    tracksList.classList.add('hidden');
    artistsList?.classList.add('hidden');
    resetKbdNav();

    if (albums.length === 0) {
        albumsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No albums found</p>';
        lastSearchAlbums = [];
        return;
    }

    lastSearchAlbums = albums;
    albumsList.innerHTML = albums.map(album => createAlbumCard(album)).join('');
    albums.forEach((album) => refreshAlbumLibraryStatus(album.id));
}

function displayArtists(artists) {
    artistsList.classList.remove('hidden');
    tracksList.classList.add('hidden');
    albumsList.classList.add('hidden');
    clearArtistHeader();
    resetKbdNav();

    if (!artists || artists.length === 0) {
        artistsList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No artists found</p>';
        return;
    }

    artistsList.innerHTML = artists.map(artist => createArtistCard(artist)).join('');
}

function createArtistCard(artist) {
    const art = artist.artist_art || 'https://via.placeholder.com/120?text=No+Image';
    const albumCount = artist.total_albums ? `${artist.total_albums} albums` : '';

    return `
        <button type="button" class="album-card" data-artist-id="${escapeHtml(String(artist.id))}">
            <img src="${art}" alt="${escapeHtml(artist.name)}" class="album-art" />
            <div class="album-info">
                <div class="album-name">${escapeHtml(artist.name)}</div>
                <div class="album-meta">${albumCount}</div>
            </div>
        </button>
    `;
}

let currentArtist = null;

function clearArtistHeader() {
    currentArtist = null;
    const header = document.getElementById('artistHeader');
    if (header) {
        header.classList.add('hidden');
        header.innerHTML = '';
    }
}

function renderArtistHeader(artist) {
    const header = document.getElementById('artistHeader');
    if (!header) return;
    currentArtist = artist;
    const albums = artist.albums || [];
    const art = artist.artist_art || '';
    header.innerHTML = `
        ${art ? `<img src="${art}" alt="${escapeHtml(artist.name || '')}" class="artist-header-art" />` : ''}
        <div class="artist-header-info">
            <div class="artist-header-name">${escapeHtml(artist.name || 'Artist')}</div>
            <div class="artist-header-meta">${albums.length} album${albums.length === 1 ? '' : 's'}</div>
        </div>
        <button type="button" id="downloadArtistBtn" class="btn btn-primary artist-download-all">
            Download all albums
        </button>
    `;
    header.classList.remove('hidden');
    document.getElementById('downloadArtistBtn')?.addEventListener('click', () => startArtistDownload(artist));
}

async function showArtistAlbums(artistId) {
    try {
        showLoading();
        resetKbdNav();
        const response = await fetch(
            resolveAppUrl(`api/artist/${encodeURIComponent(artistId)}?provider=${encodeURIComponent(getMetadataProvider())}`),
        );
        if (!response.ok) throw new Error('Failed to fetch artist');

        const artist = await response.json();
        if (!artist.id) artist.id = artistId;
        hideLoading();
        showResults();
        displayAlbums(artist.albums || []);
        renderArtistHeader(artist);
    } catch (err) {
        hideLoading();
        showError(`Failed to load artist: ${err.message}`);
    }
}

async function startArtistDownload(artist) {
    if (!artist || !artist.id) return;
    const btn = document.getElementById('downloadArtistBtn');
    if (btn) btn.disabled = true;

    const place = getDownloadLocationPlace();
    const formatSelect = document.getElementById('audioFormat');
    const qualitySelect = document.getElementById('audioQuality');
    const format = (formatSelect && formatSelect.value) ? formatSelect.value : defaultFormat;
    const quality = (qualitySelect && qualitySelect.value) ? qualitySelect.value : defaultQuality;

    try {
        showToast(`Queuing all albums by ${artist.name || 'artist'}…`, 'info');
        const response = await fetch(resolveAppUrl('api/download/artist'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                artist_id: String(artist.id),
                location: place.location,
                format: format,
                quality: quality,
                provider: getMetadataProvider(),
                max_retries: getDownloadMaxRetries(),
                ...navidromeLibraryField(place),
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            const msg = err.detail || 'Failed to start artist download';
            if (response.status === 400) {
                // Nothing to queue — already in library or still downloading. Not an error.
                showToast(msg, 'info', 6000);
                if (btn) btn.textContent = 'Nothing to download';
                return;
            }
            throw new Error(msg);
        }

        const result = await response.json();
        showDownloadStatus();

        (result.albums || []).forEach((alb) => {
            addAlbumStatusItem(alb);
            pollAlbumStatus(alb);
        });

        showToast(result.message || `Queued ${result.total_queued} track(s)`, result.status === 'already_running' ? 'info' : 'success', 6000);
        if (btn) btn.textContent = result.status === 'already_running' ? 'Downloading…' : 'Queued';
    } catch (err) {
        showError(`Artist download failed: ${err.message}`);
        if (btn) btn.disabled = false;
    }
}

// ============ ALBUM-LEVEL QUEUE ITEMS (artist download all) ============

const albumPollActive = new Set();

function addAlbumStatusItem(album) {
    const itemId = `status-album-${album.album_id}`;
    document.getElementById(itemId)?.remove();

    const item = document.createElement('div');
    item.id = itemId;
    item.className = 'status-item status-processing';

    const art = album.album_art || 'https://via.placeholder.com/50?text=No+Image';
    item.innerHTML = `
        <div class="status-item-header">
            <img src="${art}" alt="${escapeHtml(album.name || '')}" class="status-art" />
            <div class="status-item-info">
                <h3>${escapeHtml(album.name || 'Album')}</h3>
                <p class="status-artist">${escapeHtml(album.artist || '')}</p>
            </div>
            <div class="status-badge status-badge-processing">Processing</div>
        </div>
        <p class="status-message">0/${album.total_tracks || 0} tracks</p>
        <div class="progress-bar-container">
            <div class="progress-bar" style="width: 0%"></div>
        </div>
    `;
    statusContent.appendChild(item);
    updateQueueCount();
}

function updateAlbumStatusItem(albumId, status, message, progress) {
    const item = document.getElementById(`status-album-${albumId}`);
    if (!item) return;
    item.className = `status-item status-${status}`;
    const msg = item.querySelector('.status-message');
    if (msg) msg.textContent = message;
    const badge = item.querySelector('.status-badge');
    if (badge) {
        badge.className = `status-badge status-badge-${status}`;
        badge.textContent = getStatusLabel(status);
    }
    const bar = item.querySelector('.progress-bar');
    if (bar) bar.style.width = `${progress}%`;
}

function removeAlbumStatusItem(albumId) {
    const item = document.getElementById(`status-album-${albumId}`);
    if (item) {
        item.remove();
        if (statusContent.children.length === 0) hideDownloadStatus();
    }
}

function pollAlbumStatus(album) {
    const albumId = String(album.album_id);
    if (albumPollActive.has(albumId)) return;
    albumPollActive.add(albumId);

    const POLL_MS = 2000;

    const finishError = (msg) => {
        albumPollActive.delete(albumId);
        updateAlbumStatusItem(albumId, 'error', msg, 0);
        showToast(`${album.name || 'Album'}: ${msg}`, 'error', 6000);
        updateQueueCount();
    };

    const tick = async () => {
        try {
            const response = await fetch(resolveAppUrl(`api/download/album/status/${encodeURIComponent(albumId)}`));
            if (!response.ok) {
                finishError('Failed to check album status');
                return;
            }
            const s = await response.json();
            const total = s.total_tracks || album.total_tracks || 0;
            const completed = s.completed_tracks || 0;
            const failed = s.failed_tracks || 0;
            const done = completed + failed;
            const pct = total ? Math.round((done / total) * 100) : 0;
            const msg = failed ? `${completed}/${total} tracks • ${failed} failed` : `${completed}/${total} tracks`;

            if (s.status === 'completed') {
                albumPollActive.delete(albumId);
                if (failed === total && total > 0) {
                    updateAlbumStatusItem(albumId, 'error', `All ${total} tracks failed`, 100);
                    showToast(`Album failed: ${s.album_name || album.name}`, 'error', 6000);
                } else {
                    updateAlbumStatusItem(albumId, 'completed', failed ? `${msg} — done` : 'Completed', 100);
                    showToast(
                        failed
                            ? `${s.album_name || album.name}: ${completed}/${total} downloaded, ${failed} failed`
                            : `Album downloaded: ${s.album_name || album.name}`,
                        failed ? 'error' : 'success',
                        6000,
                    );
                }
                refreshAlbumLibraryStatus(albumId);
                updateQueueCount();
                setTimeout(() => removeAlbumStatusItem(albumId), 6000);
                return;
            }

            updateAlbumStatusItem(albumId, 'processing', msg, pct);
            updateQueueCount();
            setTimeout(tick, POLL_MS);
        } catch (err) {
            finishError(`Error: ${err.message}`);
        }
    };

    setTimeout(tick, POLL_MS);
}

function createAlbumCard(album) {
    const albumArt = album.album_art || 'https://via.placeholder.com/120?text=No+Image';
    const year = album.release_date ? album.release_date.split('-')[0] : '';
    const tracks = album.total_tracks ? `${album.total_tracks} tracks` : '';
    const meta = [tracks, year].filter(Boolean).join(' • ');
    const albumId = escapeHtml(String(album.id));
    
    return `
        <div class="album-card" id="album-${album.id}" data-album-id="${albumId}">
            <div class="media-art">
                <img src="${albumArt}" alt="${escapeHtml(album.name)}" class="album-art" />
                <button type="button" class="icon-dl album-dl" data-download-album="${albumId}" aria-label="Download ${escapeHtml(album.name)}">${ICON_DL}</button>
                <span class="art-check hidden">${ICON_CHECK}</span>
            </div>
            <div class="album-info">
                <div class="album-name">${escapeHtml(album.name)}</div>
                <div class="album-artist">${escapeHtml(album.artist)}</div>
                <div class="album-meta">${meta}</div>
                <div class="album-library-meta" hidden></div>
            </div>
        </div>
    `;
}

async function refreshAlbumLibraryStatus(albumId) {
    try {
        const response = await fetch(buildAlbumExistsUrl(albumId));
        if (!response.ok) return;
        const data = await response.json();
        applyAlbumLibraryStatus(albumId, data.have || 0, data.total || 0);
    } catch (err) {
        // leave the card as unknown
    }
}

function applyAlbumLibraryStatus(albumId, have, total) {
    const card = document.getElementById(`album-${albumId}`);
    if (!card) return;
    const complete = total > 0 && have === total;
    const partial = have > 0 && have < total;
    card.classList.toggle('is-owned', complete);
    card.classList.toggle('is-partial', partial);
    const meta = card.querySelector('.album-library-meta');
    const dl = card.querySelector('[data-download-album]');
    const check = card.querySelector('.art-check');
    if (complete) {
        if (meta) {
            meta.hidden = false;
            meta.textContent = 'In library';
        }
        if (dl) dl.hidden = true;
        if (check) check.classList.remove('hidden');
    } else if (partial) {
        if (meta) {
            meta.hidden = false;
            meta.textContent = `${have}/${total} in library`;
        }
        if (dl) dl.hidden = false;
        if (check) check.classList.add('hidden');
    } else {
        // Nothing owned at the selected location — reset to downloadable state
        if (meta) {
            meta.hidden = true;
            meta.textContent = '';
        }
        if (dl) dl.hidden = false;
        if (check) check.classList.add('hidden');
    }
}

let currentAlbum = null;

async function showAlbumDetails(albumId) {
    try {
        const response = await fetch(
            resolveAppUrl(`api/album/${encodeURIComponent(albumId)}?provider=${encodeURIComponent(getMetadataProvider())}`),
        );
        if (!response.ok) throw new Error('Failed to fetch album');
        
        const album = await response.json();
        currentAlbum = album;
        
        const modal = document.getElementById('albumModal');
        const title = document.getElementById('albumModalTitle');
        const details = document.getElementById('albumDetails');
        const tracksList = document.getElementById('albumTracksList');
        
        title.textContent = album.name;
        const downloadAllBtn = document.getElementById('downloadAlbumBtn');
        if (downloadAllBtn) {
            downloadAllBtn.textContent = 'Download All';
            downloadAllBtn.disabled = false;
        }
        
        const albumArt = album.album_art || 'https://via.placeholder.com/150?text=No+Image';
        const year = album.release_date ? album.release_date.split('-')[0] : '';
        
        details.innerHTML = `
            <div class="album-header">
                <img src="${albumArt}" alt="${escapeHtml(album.name)}" class="album-detail-art" />
                <div class="album-header-info">
                    <h3>${escapeHtml(album.name)}</h3>
                    <p class="album-header-artist">${escapeHtml(album.artist)}</p>
                    <p class="album-header-meta">${album.total_tracks} tracks${year ? ' • ' + year : ''}</p>
                </div>
            </div>
        `;
        
        tracksList.innerHTML = album.tracks.map((track, index) => `
            <div class="album-track" data-track-id="${escapeHtml(String(track.id))}">
                <span class="track-number">${track.track_number || index + 1}</span>
                <div class="track-details">
                    <span class="track-title">${escapeHtml(track.name)}</span>
                    <span class="track-duration">${formatDuration(track.duration_ms)}</span>
                </div>
                <div class="album-track-actions">
                    <button type="button" class="icon-dl" data-download-track="${escapeHtml(String(track.id))}" aria-label="Download ${escapeHtml(track.name)}">${ICON_DL}</button>
                </div>
            </div>
        `).join('');

        lastSearchTracks = album.tracks;
        modal.classList.remove('hidden');
        refreshAlbumModalLibrary(album);
    } catch (err) {
        showError(`Failed to load album: ${err.message}`);
    }
}

async function refreshAlbumModalLibrary(album) {
    try {
        const response = await fetch(buildAlbumExistsUrl(album.id));
        if (!response.ok) return;
        const data = await response.json();
        const haveSet = new Set(data.track_ids || []);
        (album.tracks || []).forEach((track) => {
            if (haveSet.has(String(track.id))) updateTrackToDownloaded(track.id);
        });
        applyAlbumLibraryStatus(album.id, data.have || 0, data.total || 0);
        const btn = document.getElementById('downloadAlbumBtn');
        const meta = document.querySelector('.album-header-meta');
        if (data.exists) {
            if (btn) {
                btn.textContent = 'In library';
                btn.disabled = true;
            }
        } else if (data.have > 0) {
            const missing = (data.total || 0) - (data.have || 0);
            if (btn) {
                btn.textContent = `Download missing (${missing})`;
                btn.disabled = false;
            }
        } else if (btn) {
            btn.textContent = 'Download All';
            btn.disabled = false;
        }
        if (meta && data.total) {
            const year = album.release_date ? album.release_date.split('-')[0] : '';
            const lib = data.exists
                ? 'In library'
                : (data.have ? `${data.have}/${data.total} in library` : `${data.total} tracks`);
            meta.textContent = year ? `${lib} • ${year}` : lib;
        }
    } catch (err) {
        // keep default modal
    }
}

function hideAlbumModal() {
    document.getElementById('albumModal').classList.add('hidden');
    currentAlbum = null;
}

async function downloadAlbum() {
    if (!currentAlbum) return;
    await startAlbumDownload(currentAlbum, { closeModal: true });
}

async function startAlbumDownload(album, options = {}) {
    if (!album || !album.id) return;

    const place = getDownloadLocationPlace();
    const formatSelect = document.getElementById('audioFormat');
    const qualitySelect = document.getElementById('audioQuality');
    const format = (formatSelect && formatSelect.value) ? formatSelect.value : defaultFormat;
    const quality = (qualitySelect && qualitySelect.value) ? qualitySelect.value : defaultQuality;
    const dlBtn = document.querySelector(`[data-download-album="${CSS.escape(String(album.id))}"]`);
    if (dlBtn) dlBtn.disabled = true;

    try {
        const response = await fetch(resolveAppUrl('api/download/album'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                album_id: album.id,
                location: place.location,
                format: format,
                quality: quality,
                provider: getMetadataProvider(),
                max_retries: getDownloadMaxRetries(),
                ...navidromeLibraryField(place),
            })
        });
        
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            const msg = err.detail || 'Failed to start album download';
            if (response.status === 400) {
                // Nothing to queue — already in library or still downloading. Not an error.
                showToast(msg, 'info', 6000);
                if (dlBtn) dlBtn.disabled = false;
                return;
            }
            throw new Error(msg);
        }

        const result = await response.json();

        showDownloadStatus();
        if (result.message) showToast(result.message, 'info', 5000);

        if (result.status === 'already_running') {
            // Re-attach a single progress item to the already-running album jobs
            addAlbumStatusItem({
                album_id: album.id,
                name: album.name || 'Album',
                artist: album.artist || '',
                album_art: album.album_art || null,
                total_tracks: result.total_tracks || (album.tracks || []).length,
            });
            pollAlbumStatus({ album_id: album.id, name: album.name, total_tracks: result.total_tracks });
            if (options.closeModal) hideAlbumModal();
            return;
        }

        const queuedIds = result.queued_track_ids || [];
        const knownTracks = album.tracks || [];
        queuedIds.forEach((id) => {
            const track = knownTracks.find((t) => String(t.id) === String(id)) || {
                id,
                name: album.name || 'Album track',
                artist: album.artist || '',
                album: album.name || '',
                album_art: album.album_art || null,
            };
            pendingRetryByTrackId.set(id, { track, videoId: null });
            activeDownloads.set(id, { status: 'queued', progress: 0, track });
            addStatusItem(id, track, 'queued', `Queued (Album: ${album.name || album.id})`, 0);
            pollDownloadStatus(id, track);
        });

        if (options.closeModal) hideAlbumModal();
        
    } catch (err) {
        showError(`Album download failed: ${err.message}`);
        if (dlBtn) dlBtn.disabled = false;
    }
}

// Album modal event listeners
document.getElementById('albumModalClose')?.addEventListener('click', hideAlbumModal);
document.getElementById('closeAlbumModal')?.addEventListener('click', hideAlbumModal);
document.getElementById('downloadAlbumBtn')?.addEventListener('click', downloadAlbum);
document.getElementById('albumModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'albumModal') hideAlbumModal();
});
document.getElementById('albumTracksList')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-download-track]');
    if (!btn || btn.disabled || !currentAlbum) return;
    const id = btn.getAttribute('data-download-track');
    const track = (currentAlbum.tracks || []).find((t) => String(t.id) === String(id));
    if (track) downloadTrack(track);
});


// ============ LIBRARY INDEX (settings) ============

async function refreshLibraryIndexStats() {
    const el = document.getElementById('libraryIndexStats');
    try {
        const r = await fetch(resolveAppUrl('api/library/index-stats'));
        if (!r.ok) return;
        const s = await r.json();
        if (el) {
            const when = s.last_scan_ms
                ? new Date(s.last_scan_ms).toLocaleTimeString()
                : 'never';
            el.textContent = `${s.total} files indexed • last scan ${when}`;
        }
    } catch (e) {
        // leave hint text as-is
    }
}

document.getElementById('rescanLibraryBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('rescanLibraryBtn');
    if (btn) btn.disabled = true;
    try {
        const r = await fetch(resolveAppUrl('api/library/reindex'), { method: 'POST' });
        if (!r.ok) throw new Error('Rescan failed to start');
        showToast('Library rescan started…', 'info');
        setTimeout(async () => {
            await refreshLibraryIndexStats();
            const el = document.getElementById('libraryIndexStats');
            if (el && el.textContent) {
                showToast(el.textContent, 'success');
            }
            refreshLibraryIndicatorsForCurrentView();
            if (btn) btn.disabled = false;
        }, 4000);
    } catch (err) {
        showToast(err.message || 'Rescan failed', 'error');
        if (btn) btn.disabled = false;
    }
});

refreshLibraryIndexStats();
