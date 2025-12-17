// Configuration - use relative URLs since frontend is served from same origin
const API_BASE_URL = '';

// DOM elements
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const loading = document.getElementById('loading');
const error = document.getElementById('error');
const results = document.getElementById('results');
const tracksList = document.getElementById('tracksList');
const downloadStatus = document.getElementById('downloadStatus');
const statusContent = document.getElementById('statusContent');

// Track download status tracking
const activeDownloads = new Map();

// Event listeners
searchBtn.addEventListener('click', handleSearch);
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleSearch();
    }
});

async function handleSearch() {
    const query = searchInput.value.trim();
    
    if (!query) {
        showError('Please enter a search query');
        return;
    }
    
    hideError();
    showLoading();
    hideResults();
    
    try {
        const tracks = await searchTracks(query);
        await displayTracks(tracks);
        hideLoading();
        showResults();
    } catch (err) {
        hideLoading();
        showError(`Search failed: ${err.message}`);
    }
}

async function searchTracks(query) {
    const response = await fetch(`${API_BASE_URL}/api/search`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, limit: 20 }),
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Search failed');
    }
    
    return await response.json();
}

async function displayTracks(tracks) {
    if (tracks.length === 0) {
        tracksList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No tracks found</p>';
        return;
    }
    
    // Check which tracks are already downloaded
    const downloadedTracks = new Set();
    const checkPromises = tracks.map(async (track) => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/track/${track.id}/exists`);
            if (response.ok) {
                const data = await response.json();
                if (data.exists) {
                    downloadedTracks.add(track.id);
                }
            }
        } catch (err) {
            // Silently fail - just won't show as downloaded
        }
    });
    
    await Promise.all(checkPromises);
    
    tracksList.innerHTML = tracks.map(track => createTrackCard(track, downloadedTracks.has(track.id))).join('');
    
    // Add event listeners to download buttons
    tracks.forEach(track => {
        const downloadBtn = document.getElementById(`download-${track.id}`);
        if (downloadBtn && !downloadedTracks.has(track.id)) {
            downloadBtn.addEventListener('click', () => downloadTrack(track));
        }
    });
}

function createTrackCard(track, isDownloaded = false) {
    const albumArt = track.album_art || 'https://via.placeholder.com/80?text=No+Image';
    const duration = formatDuration(track.duration_ms);
    const isDownloading = activeDownloads.has(track.id);
    
    return `
        <div class="track-card">
            <img src="${albumArt}" alt="${track.album}" class="track-art" />
            <div class="track-info">
                <div class="track-name">${escapeHtml(track.name)}</div>
                <div class="track-artist">${escapeHtml(track.artist)}</div>
                <div class="track-album">${escapeHtml(track.album)} • ${duration}</div>
            </div>
            <div class="track-actions">
                ${isDownloaded ? `
                    <span class="downloaded-badge">✓ Downloaded</span>
                ` : `
                    <button 
                        id="download-${track.id}" 
                        class="btn btn-download"
                        ${isDownloading ? 'disabled' : ''}
                    >
                        ${isDownloading ? 'Downloading...' : 'Download'}
                    </button>
                `}
            </div>
        </div>
    `;
}

async function downloadTrack(track, selectedVideoId = null) {
    const trackId = track.id;
    
    // Get download location preference
    const downloadLocation = document.getElementById('downloadLocation').value;
    
    // If no video selected, first check if we need user confirmation
    if (!selectedVideoId) {
        try {
            updateDownloadButton(trackId, true);
            console.log('Fetching YouTube candidates for:', trackId);
            const candidatesResponse = await fetch(`${API_BASE_URL}/api/youtube/candidates/${trackId}`);
            
            if (candidatesResponse.ok) {
                const data = await candidatesResponse.json();
                console.log('Candidates response:', data);
                
                // If confidence is low, show candidate selection modal
                if (data.needs_confirmation && data.candidates && data.candidates.length > 0) {
                    console.log('Low confidence, showing modal. Best score:', data.best_score);
                    updateDownloadButton(trackId, false);
                    showCandidateModal(track, data.candidates, downloadLocation);
                    return;
                }
                
                // High confidence - use best match's video ID
                if (data.candidates && data.candidates.length > 0) {
                    console.log('High confidence, auto-selecting:', data.candidates[0].title);
                    selectedVideoId = data.candidates[0].video_id;
                }
            } else {
                console.error('Candidates fetch failed:', candidatesResponse.status);
            }
        } catch (err) {
            console.error('Candidate check failed:', err);
            // Continue without video_id - backend will search
        }
    }
    
    // Mark as downloading
    activeDownloads.set(trackId, { status: 'queued', progress: 0, track: track });
    updateDownloadButton(trackId, true);
    
    try {
        // Show download status section
        showDownloadStatus();
        addStatusItem(trackId, track, 'queued', 'Download queued...', 0);
        
        // Start download
        const response = await fetch(`${API_BASE_URL}/api/download`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ 
                track_id: trackId,
                location: downloadLocation,
                video_id: selectedVideoId  // Pass selected video ID if any
            }),
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Download failed');
        }
        
        // Poll for status updates
        pollDownloadStatus(trackId, track);
        
    } catch (err) {
        updateDownloadButton(trackId, false);
        activeDownloads.delete(trackId);
        showError(`Download failed: ${err.message}`);
    }
}

// Candidate selection modal
let pendingTrack = null;
let pendingLocation = null;

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
    candidatesList.innerHTML = candidates.map((candidate, index) => `
        <div class="candidate-card" data-video-id="${candidate.video_id}">
            <img src="${candidate.thumbnail || 'https://via.placeholder.com/120x68?text=No+Thumb'}" 
                 alt="Thumbnail" class="candidate-thumb" />
            <div class="candidate-info">
                <div class="candidate-title">${escapeHtml(candidate.title)}</div>
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
            hideCandidateModal();
            downloadTrack(pendingTrack, videoId);
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

async function pollDownloadStatus(trackId, track) {
    const pollInterval = setInterval(async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/api/download/status/${trackId}`);
            
            if (!response.ok) {
                clearInterval(pollInterval);
                updateStatusItem(trackId, 'error', 'Failed to check status');
                updateDownloadButton(trackId, false);
                activeDownloads.delete(trackId);
                return;
            }
            
            const status = await response.json();
            // Store track info with status
            status.track = track;
            activeDownloads.set(trackId, status);
            
            // Get progress (default to 0 if not provided)
            const progress = status.progress !== undefined ? status.progress : getProgressFromStatus(status.status, status.message);
            updateStatusItem(trackId, status.status, status.message, progress);
            
            if (status.status === 'completed' || status.status === 'error') {
                clearInterval(pollInterval);
                updateDownloadButton(trackId, false);
                updateQueueCount();
                
                if (status.status === 'completed') {
                    // If it's a local download, trigger browser download
                    if (status.download_url) {
                        // Trigger browser download (saves to user's Downloads folder)
                        const link = document.createElement('a');
                        link.href = status.download_url;
                        link.download = status.file_path.split('/').pop() || 'download.mp3';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        
                        updateStatusItem(trackId, 'completed', 'Download started - check your Downloads folder', 100);
                    } else {
                        // Navidrome download - just show as completed
                        updateTrackToDownloaded(trackId);
                    }
                    
                    // Keep completed items visible for a bit, then remove
                    setTimeout(() => {
                        removeStatusItem(trackId);
                        activeDownloads.delete(trackId);
                    }, 5000);
                } else {
                    // Error - keep in queue but don't auto-remove
                    activeDownloads.delete(trackId);
                }
            } else {
                updateQueueCount();
            }
        } catch (err) {
            clearInterval(pollInterval);
            updateStatusItem(trackId, 'error', `Error: ${err.message}`);
            updateDownloadButton(trackId, false);
            activeDownloads.delete(trackId);
        }
    }, 2000); // Poll every 2 seconds
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
    const button = document.getElementById(`download-${trackId}`);
    if (button) {
        button.disabled = downloading;
        button.textContent = downloading ? 'Downloading...' : 'Download';
    }
}

function updateTrackToDownloaded(trackId) {
    const button = document.getElementById(`download-${trackId}`);
    if (button) {
        const trackCard = button.closest('.track-card');
        if (trackCard) {
            const actionsDiv = trackCard.querySelector('.track-actions');
            if (actionsDiv) {
                actionsDiv.innerHTML = '<span class="downloaded-badge">✓ Downloaded</span>';
            }
        }
    }
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

function showDownloadStatus() {
    downloadStatus.classList.remove('hidden');
    updateQueueCount();
}

function hideDownloadStatus() {
    downloadStatus.classList.add('hidden');
}

function updateQueueCount() {
    const queueCount = document.getElementById('queueCount');
    if (queueCount) {
        const activeCount = Array.from(activeDownloads.values()).filter(s => s.status !== 'completed' && s.status !== 'error').length;
        queueCount.textContent = activeCount > 0 ? `(${activeCount} active)` : '';
    }
}

