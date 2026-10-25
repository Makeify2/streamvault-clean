import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  Search, LogOut, Film, Tv, Settings, RefreshCw, Loader2,
  CheckCircle2, ArrowDownCircle, SlidersHorizontal, Eye, EyeOff, X, Play, Heart,
  AlertCircle, Info, PlusCircle, BookmarkPlus, BookmarkCheck, Trash2, ChevronRight,
  LayoutGrid, List as ListIcon, Square, SquareCheck
} from 'lucide-react';
import type { SubtitleTrack, VideoFile, TorrentMetadata, Torrent } from '../types';
import {
  type LibraryItem,
  addLibraryItem,
  removeLibraryItem,
  getLibraryItems,
} from '../lib/libraryDB';
import { apiUrl } from '../lib/api';
import { formatTime } from '../lib/utils';
import { getLoadingMessage } from '../lib/loadingMessages';
import { DetailModal } from '../components/DetailModal';
import { BadgeBar } from '../components/BadgeBar';
import { SettingsModal } from '../components/SettingsModal';
import { DownloadManagerModal } from '../components/DownloadManagerModal';

interface SavedProgress {
  t: number;
  d: number;
  at: number;
}

interface ResumeItem {
  torrentId: number;
  fileId: number;
  torrent: Torrent;
  progressSecs: number;
  durationSecs: number;
  savedAt: number;
}

interface TmdbSearchResult {
  id: number;
  title?: string;
  name?: string;
  overview: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
}

interface TVEpisode {
  id: number;
  episode_number: number;
  name: string;
  overview: string;
  air_date: string;
  still_path: string | null;
  vote_average: number;
}

interface LibPickerState {
  tmdbId: number;
  title: string;
  posterPath?: string;
  defaultSeason: number;
}

type SortMode = 'added' | 'title' | 'size' | 'progress';

interface DashboardProps {
  onPlay: (
    torrentId: number | string | undefined,
    fileId: number | string | undefined,
    filename: string,
    subtitles: SubtitleTrack[],
    videoFiles?: VideoFile[],
    torrentMetadata?: TorrentMetadata
  ) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onPlay }) => {
  const { token, logout } = useAuth();
  
  const [library, setLibrary] = useState<Torrent[]>([]);
  const [localFiles, setLocalFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  
  // Filtering & Searching States
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'movie' | 'tv' | 'downloading' | 'other' | 'library' | 'unmapped'>('all');
  const [sortMode, setSortMode] = useState<SortMode>('added');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // Selected Detail Modal
  const [selectedTorrent, setSelectedTorrent] = useState<Torrent | null>(null);

  // Remap Modal States
  const [remapTorrent, setRemapTorrent] = useState<Torrent | null>(null);
  const [remapHashes, setRemapHashes] = useState<string[]>([]);
  const [remapTmdbId, setRemapTmdbId] = useState('');
  const [remapType, setRemapType] = useState<'movie' | 'tv' | 'other'>('movie');
  const [remapSubmitting, setRemapSubmitting] = useState(false);
  const [remapError, setRemapError] = useState('');
  // Remap TMDb search states
  const [remapQuery, setRemapQuery] = useState('');
  const [remapResults, setRemapResults] = useState<TmdbSearchResult[]>([]);
  const [remapSearching, setRemapSearching] = useState(false);

  // Toast notifications
  interface ToastMsg { message: string; type: 'success' | 'info' | 'error'; }
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string, type: ToastMsg['type'] = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  // Settings modal
  const [showSettings, setShowSettings] = useState(false);

  // Download Manager modal
  const [showDownloadManager, setShowDownloadManager] = useState(false);

  // Loading screen copy (occasionally swapped for a fun message)
  const [loadingMessage] = useState(() => getLoadingMessage('Loading library torrent cache...'));

  // Watchlist: persisted set of torrent IDs
  const [watchlist, setWatchlist] = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem('sv-watchlist');
      return raw ? new Set<number>(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Genre filter
  const [activeGenre, setActiveGenre] = useState<string | null>(null);

  // Local library (IndexedDB)
  const [localLibrary, setLocalLibrary] = useState<LibraryItem[]>([]);
  const [libInDB, setLibInDB] = useState<Set<number>>(new Set());
  // Library search state
  const [libSearchQuery, setLibSearchQuery] = useState('');
  const [libSearchType, setLibSearchType] = useState<'movie' | 'tv'>('movie');
  const [libSearchResults, setLibSearchResults] = useState<TmdbSearchResult[]>([]);
  const [libSearching, setLibSearching] = useState(false);
  const [libSearchError, setLibSearchError] = useState('');

  // Library TV episode picker
  const [libPickerState, setLibPickerState] = useState<LibPickerState | null>(null);
  const [libPickerSeason, setLibPickerSeason] = useState(1);
  const [libPickerEpisodes, setLibPickerEpisodes] = useState<TVEpisode[]>([]);
  const [libPickerLoading, setLibPickerLoading] = useState(false);
  const [libPickerError, setLibPickerError] = useState('');

  // Tracks readiness per torrent ID to detect completed downloads
  const prevReadyRef = useRef<Map<number, boolean>>(new Map());

  // Fetch Library from backend
  const fetchLibrary = async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    setError('');
    
    try {
      const response = await fetch(apiUrl('/api/torrents'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      
      if (response.ok && data.success) {
        const newLibrary: Torrent[] = data.data || [];
        setLibrary(newLibrary);
        // Fetch local media files
        try {
          const localRes = await fetch(apiUrl('/api/local/files'), {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const localData = await localRes.json();
          if (localRes.ok && localData.success) {
            setLocalFiles(localData.data.map((f: any) => f.name));
          }
        } catch {} // non-critical
        // Fire browser notification for any torrent that just finished downloading
        if (isSilent && prevReadyRef.current.size > 0 && Notification.permission === 'granted') {
          newLibrary.forEach(t => {
            if (prevReadyRef.current.get(t.id) === false && t.ready) {
              new Notification('Download complete', {
                body: `"${t.metadata.title}" is ready to stream!`,
              });
            }
          });
        }
        const nextMap = new Map<number, boolean>();
        newLibrary.forEach(t => nextMap.set(t.id, t.ready));
        prevReadyRef.current = nextMap;
      } else if (response.status === 401) {
        window.dispatchEvent(new CustomEvent('sv-auth-expired'));
      } else {
        setError(data.detail || 'Failed to fetch media library.');
      }
    } catch (err) {
      console.error(err);
      setError('Connection failure: Unable to reach streaming backend.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const refreshLocalLibrary = useCallback(async () => {
    try {
      const items = await getLibraryItems();
      setLocalLibrary(items);
      setLibInDB(new Set(items.map(i => i.tmdbId)));
    } catch { /* IndexedDB unavailable */ }
  }, []);

  useEffect(() => { refreshLocalLibrary(); }, [refreshLocalLibrary]);

  const handleLibSearch = async () => {
    if (!libSearchQuery.trim()) return;
    setLibSearching(true);
    setLibSearchError('');
    try {
      const params = new URLSearchParams({ query: libSearchQuery.trim(), type: libSearchType });
      const response = await fetch(apiUrl(`/api/tmdb/search?${params}`), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setLibSearchResults((data.data || []).slice(0, 8));
        if ((data.data || []).length === 0) setLibSearchError('No results — try a different title.');
      } else {
        setLibSearchError(data.detail || 'TMDb search failed.');
      }
    } catch {
      setLibSearchError('Network error during search.');
    } finally {
      setLibSearching(false);
    }
  };

  const handleAddToLibrary = async (result: TmdbSearchResult, type: 'movie' | 'tv') => {
    const item: LibraryItem = {
      tmdbId: result.id,
      title: result.title || result.name || 'Untitled',
      posterPath: result.poster_path ? `https://image.tmdb.org/t/p/w342${result.poster_path}` : undefined,
      type,
      season: type === 'tv' ? 1 : undefined,
      episode: type === 'tv' ? 1 : undefined,
      addedAt: Date.now(),
    };
    await addLibraryItem(item);
    await refreshLocalLibrary();
    showToast(`"${item.title}" added to library`);
  };

  const handleRemoveFromLibrary = async (tmdbId: number, title: string) => {
    await removeLibraryItem(tmdbId);
    await refreshLocalLibrary();
    showToast(`"${title}" removed from library`, 'info');
  };

  const playLibraryItem = (item: LibraryItem) => {
    const metadata: TorrentMetadata = {
      title: item.title,
      posterPath: item.posterPath,
      type: item.type,
      tmdbId: item.tmdbId,
      isMedia: true,
      parsed: {
        season: item.season,
        episode: item.episode,
      }
    };
    onPlay(undefined, undefined, '', [], [], metadata);
  };

  const openLibPicker = (state: LibPickerState) => {
    setLibPickerState(state);
    setLibPickerSeason(state.defaultSeason);
    setLibPickerEpisodes([]);
    setLibPickerError('');
  };

  const closeLibPicker = () => {
    setLibPickerState(null);
    setLibPickerEpisodes([]);
    setLibPickerError('');
  };

  const playLibraryEpisode = (ep: TVEpisode) => {
    if (!libPickerState) return;
    const metadata: TorrentMetadata = {
      title: libPickerState.title,
      posterPath: libPickerState.posterPath,
      type: 'tv',
      tmdbId: libPickerState.tmdbId,
      isMedia: true,
      parsed: { season: libPickerSeason, episode: ep.episode_number },
    };
    onPlay(undefined, undefined, '', [], [], metadata);
    closeLibPicker();
  };

  // Fetch episodes when picker opens or season changes
  useEffect(() => {
    if (!libPickerState) return;
    let cancelled = false;
    const fetchEps = async () => {
      setLibPickerLoading(true);
      setLibPickerError('');
      try {
        const response = await fetch(apiUrl(`/api/tmdb/tv/${libPickerState.tmdbId}/season/${libPickerSeason}`), {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (cancelled) return;
        if (response.ok && data.success && data.data) {
          const eps: TVEpisode[] = data.data.episodes || [];
          setLibPickerEpisodes(eps);
          if (eps.length === 0) setLibPickerError('No episodes found for this season.');
        } else {
          setLibPickerEpisodes([]);
          setLibPickerError('Could not load episodes for this season.');
        }
      } catch {
        if (!cancelled) setLibPickerError('Network error loading episodes.');
      } finally {
        if (!cancelled) setLibPickerLoading(false);
      }
    };
    fetchEps();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libPickerState?.tmdbId, libPickerSeason, token]);

  // Close picker on Escape
  useEffect(() => {
    if (!libPickerState) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeLibPicker(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libPickerState]);

  // Debounce search input by 300 ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Auto-refresh while any torrent is still downloading
  const hasActiveDownloads = library.some(t => !t.ready);
  useEffect(() => {
    if (!hasActiveDownloads) return;
    const interval = window.setInterval(() => fetchLibrary(true), 30000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActiveDownloads]);

  // Request notification permission when downloads are active
  useEffect(() => {
    if (hasActiveDownloads && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [hasActiveDownloads]);

  // Open the remap modal pre-filled with the parsed title.
  // Collects all hashes from consolidated sources so all get remapped together.
  const openRemapModal = (torrent: Torrent) => {
    setRemapTorrent(torrent);
    setRemapHashes(
      torrent.sources && torrent.sources.length > 0
        ? torrent.sources.map(s => s.hash)
        : [torrent.hash]
    );
    setRemapTmdbId(torrent.metadata.tmdbId ? String(torrent.metadata.tmdbId) : '');
    setRemapType(torrent.metadata.type === 'tv' ? 'tv' : 'movie');
    setRemapQuery(torrent.metadata.parsed?.title || torrent.metadata.title || '');
    setRemapResults([]);
    setRemapError('');
  };

  const closeRemapModal = () => {
    setRemapTorrent(null);
    setRemapHashes([]);
    setRemapTmdbId('');
    setRemapQuery('');
    setRemapResults([]);
    setRemapError('');
  };

  // Close remap modal on Escape
  useEffect(() => {
    if (!remapTorrent) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRemapModal(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remapTorrent]);

  // Search TMDb by name from inside the remap modal
  const handleRemapSearch = async () => {
    if (!remapQuery.trim()) return;
    setRemapSearching(true);
    setRemapError('');
    try {
      const params = new URLSearchParams({ query: remapQuery.trim(), type: remapType });
      const response = await fetch(apiUrl(`/api/tmdb/search?${params}`), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setRemapResults((data.data || []).slice(0, 8));
        if ((data.data || []).length === 0) {
          setRemapError('No TMDb results — try a different title or switch Movie/TV.');
        }
      } else {
        setRemapError(data.detail || 'TMDb search failed.');
      }
    } catch (err) {
      console.error(err);
      setRemapError('Network error during TMDb search.');
    } finally {
      setRemapSearching(false);
    }
  };

  // Handle Manual Remapping submit
  const handleRemapSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!remapTorrent || !remapTmdbId) return;

    setRemapSubmitting(true);
    setRemapError('');

    try {
      const response = await fetch(apiUrl('/api/torrents/map-manually'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          hashes: remapHashes,
          tmdbId: parseInt(remapTmdbId, 10),
          type: remapType
        })
      });
      const data = await response.json();

      if (response.ok && data.success) {
        closeRemapModal();
        showToast('Metadata updated!');
        fetchLibrary(true); // silent refresh
      } else {
        setRemapError(data.detail || 'Mapping update failed.');
      }
    } catch (err) {
      console.error(err);
      setRemapError('Network error trying to remap media.');
    } finally {
      setRemapSubmitting(false);
    }
  };

  // Filter, search, and sort logic
  const filteredLibrary = useMemo(() => {
    const query = debouncedQuery.toLowerCase();
    const filtered = library.filter((torrent) => {
      const matchesSearch =
        torrent.metadata.title.toLowerCase().includes(query) ||
        torrent.name.toLowerCase().includes(query);
      if (!matchesSearch) return false;

      if (activeFilter === 'other') return !torrent.isMedia;
      if (activeFilter === 'downloading') return !torrent.ready;
      if (activeFilter === 'unmapped') return !torrent.metadata.tmdbId;
      // Games/software stay tucked away in the Other tab
      if (!torrent.isMedia) return false;
      if (activeFilter === 'movie') return torrent.metadata.type === 'movie';
      if (activeFilter === 'tv') return torrent.metadata.type === 'tv';
      if (activeGenre && !(torrent.metadata.genres || []).includes(activeGenre)) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === 'title') return a.metadata.title.localeCompare(b.metadata.title);
      if (sortMode === 'size') return b.size - a.size;
      if (sortMode === 'progress') return (a.ready ? 1 : 0) - (b.ready ? 1 : 0) || b.progress - a.progress;
      return b.id - a.id; // 'added': newest TorBox entries first
    });
  }, [library, debouncedQuery, activeFilter, sortMode, activeGenre]);

  const otherCount = library.filter(t => !t.isMedia).length;
  const unmappedCount = library.filter(t => !t.metadata.tmdbId).length;

  const toggleSelected = (torrentId: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(torrentId)) next.delete(torrentId);
      else next.add(torrentId);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // Batch remap: collect every hash from the selected (consolidated) torrents.
  const openBatchRemap = () => {
    const selected = library.filter(t => selectedIds.has(t.id));
    if (selected.length === 0) return;
    const hashes: string[] = [];
    selected.forEach(t => {
      if (t.sources && t.sources.length > 0) {
        t.sources.forEach(s => hashes.push(s.hash));
      } else {
        hashes.push(t.hash);
      }
    });
    const first = selected[0];
    setRemapTorrent(first);
    setRemapHashes(hashes);
    setRemapTmdbId(first.metadata.tmdbId ? String(first.metadata.tmdbId) : '');
    setRemapType(first.metadata.type === 'tv' ? 'tv' : 'movie');
    setRemapQuery(first.metadata.parsed?.title || first.metadata.title || '');
    setRemapResults([]);
    setRemapError('');
    clearSelection();
  };

  const filteredLocalLibrary = useMemo(() => {
    const query = debouncedQuery.toLowerCase();
    if (!query) return localLibrary;
    return localLibrary.filter(item => item.title.toLowerCase().includes(query));
  }, [localLibrary, debouncedQuery]);

  // Unique genres across all media for filter chips
  const allGenres = useMemo(() => {
    const genreSet = new Set<string>();
    library.forEach(t => {
      if (t.isMedia) (t.metadata.genres || []).forEach(g => genreSet.add(g));
    });
    return Array.from(genreSet).sort();
  }, [library]);

  // Watchlist items cross-referenced against loaded library
  const watchlistItems = useMemo(
    () => library.filter(t => watchlist.has(t.id)),
    [library, watchlist]
  );

  // Recently Added: top 10 media items sorted by TorBox ID descending
  const recentlyAdded = useMemo(
    () => [...library]
      .filter(t => t.isMedia)
      .sort((a, b) => b.id - a.id)
      .slice(0, 10),
    [library]
  );

  // Bump version whenever the player writes/clears progress so chips stay current
  const [resumeVersion, setResumeVersion] = useState(0);
  useEffect(() => {
    const handler = () => setResumeVersion(v => v + 1);
    window.addEventListener('sv-progress', handler);
    return () => window.removeEventListener('sv-progress', handler);
  }, []);

  // Torrents with partially-watched files (saved by the player as sv-progress:<torrentId>:<fileId>)
  const resumableTorrents = useMemo(() => {
    const ids = new Set<number>();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const match = key?.match(/^sv-progress:(\d+):/);
      if (match) ids.add(parseInt(match[1], 10));
    }
    return ids;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, resumeVersion]);

  // Continue Watching: items with saved progress matched to library cards
  const continueWatching = useMemo((): ResumeItem[] => {
    const items: ResumeItem[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const match = key?.match(/^sv-progress:(\d+):(\d+)$/);
      if (!match) continue;
      const torrentId = parseInt(match[1], 10);
      const fileId = parseInt(match[2], 10);
      try {
        const raw = localStorage.getItem(key!);
        if (!raw) continue;
        const prog = JSON.parse(raw) as SavedProgress;
        const torrent = library.find(t => t.id === torrentId);
        if (torrent && prog.d > 0) {
          items.push({ torrentId, fileId, torrent, progressSecs: prog.t, durationSecs: prog.d, savedAt: prog.at });
        }
      } catch {
        // ignore corrupt entries
      }
    }
    return items.sort((a, b) => b.savedAt - a.savedAt);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, resumeVersion]);

  const handleResumePlay = (item: ResumeItem) => {
    const file = item.torrent.videoFiles.find(f => f.id === item.fileId)
      ?? item.torrent.videoFiles[0];
    if (!file) return;
    onPlay(item.torrentId, file.id, file.name, file.subtitles, item.torrent.videoFiles, item.torrent.metadata);
  };

  const dismissContinueItem = (item: ResumeItem) => {
    localStorage.removeItem(`sv-progress:${item.torrentId}:${item.fileId}`);
    window.dispatchEvent(new CustomEvent('sv-progress'));
  };

  const markTorrentWatched = (torrentId: number) => {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(`sv-progress:${torrentId}:`)) toRemove.push(key);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
    window.dispatchEvent(new CustomEvent('sv-progress'));
    showToast('Marked as watched');
  };

  const toggleWatchlist = (torrentId: number) => {
    setWatchlist(prev => {
      const next = new Set(prev);
      const adding = !next.has(torrentId);
      if (adding) next.add(torrentId); else next.delete(torrentId);
      localStorage.setItem('sv-watchlist', JSON.stringify(Array.from(next)));
      showToast(adding ? 'Added to Watchlist' : 'Removed from Watchlist', 'info');
      return next;
    });
  };

  return (
    <div style={styles.page} className="sv-page">
      {/* Top Header */}
      <header className="glass-panel" style={styles.header}>
        <div style={styles.logoRow}>
          <Film size={26} color="var(--accent-primary)" style={{ filter: 'drop-shadow(var(--shadow-glow))' }} />
          <h1 style={styles.brandTitle}>Private TorBox Streamer</h1>
        </div>
        
        <div style={styles.headerActions}>
          <button
            onClick={() => fetchLibrary(true)}
            className="glass-button"
            style={styles.headerBtn}
            disabled={loading || refreshing}
          >
            {refreshing ? <Loader2 size={16} className="spinner" /> : <RefreshCw size={16} />}
            <span>Refresh</span>
          </button>

          <button
            onClick={() => setShowDownloadManager(true)}
            className="glass-button glass-button-primary"
            style={styles.headerBtn}
            title="Add a torrent to TorBox"
          >
            <PlusCircle size={16} />
            <span>Add Torrent</span>
          </button>

          <button onClick={() => setShowSettings(true)} className="glass-button" style={styles.headerBtn} title="Settings">
            <Settings size={16} />
            <span>Settings</span>
          </button>

          <button onClick={logout} className="glass-button" style={styles.logoutBtn}>
            <LogOut size={16} />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

      {showDownloadManager && (
        <DownloadManagerModal
          token={token!}
          onClose={() => setShowDownloadManager(false)}
          onSuccess={(msg) => showToast(msg)}
          onLibraryRefresh={() => fetchLibrary(true)}
        />
      )}

      {/* Toolbar Options */}
      <div style={styles.toolbar} className="sv-toolbar">
        {/* Search */}
        <div style={styles.searchWrapper} className="sv-search-wrapper">
          <Search size={18} style={styles.searchIcon} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search local torrent library..."
            className="glass-input"
            style={styles.searchInput}
            aria-label="Search library"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={styles.searchClearBtn}
              aria-label="Clear search"
            >
              <X size={15} />
            </button>
          )}
        </div>

        {/* Filters */}
        <div style={styles.filters} className="sv-filters">
          <button
            onClick={() => setActiveFilter('all')}
            style={activeFilter === 'all' ? styles.filterBtnActive : styles.filterBtn}
            aria-pressed={activeFilter === 'all'}
          >
            All Media
          </button>
          <button
            onClick={() => setActiveFilter('movie')}
            style={activeFilter === 'movie' ? styles.filterBtnActive : styles.filterBtn}
            aria-pressed={activeFilter === 'movie'}
          >
            Movies
          </button>
          <button
            onClick={() => setActiveFilter('tv')}
            style={activeFilter === 'tv' ? styles.filterBtnActive : styles.filterBtn}
            aria-pressed={activeFilter === 'tv'}
          >
            TV Shows
          </button>
          <button
            onClick={() => setActiveFilter('downloading')}
            style={activeFilter === 'downloading' ? styles.filterBtnActive : styles.filterBtn}
            aria-pressed={activeFilter === 'downloading'}
          >
            Downloading
          </button>
          {otherCount > 0 && (
            <button
              onClick={() => setActiveFilter('other')}
              style={activeFilter === 'other' ? styles.filterBtnActive : styles.filterBtn}
              aria-pressed={activeFilter === 'other'}
            >
              Other ({otherCount})
            </button>
          )}
          {unmappedCount > 0 && (
            <button
              onClick={() => setActiveFilter('unmapped')}
              style={activeFilter === 'unmapped' ? styles.filterBtnActive : styles.filterBtn}
              aria-pressed={activeFilter === 'unmapped'}
            >
              Not Mapped ({unmappedCount})
            </button>
          )}
          <button
            onClick={() => setActiveFilter('library')}
            style={activeFilter === 'library' ? styles.filterBtnActive : styles.filterBtn}
            aria-pressed={activeFilter === 'library'}
          >
            My Library{localLibrary.length > 0 ? ` (${localLibrary.length})` : ''}
          </button>
        </div>

        {/* Sorting */}
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="glass-input"
          style={styles.sortSelect}
          title="Sort library"
        >
          <option value="added" style={styles.sortOption}>Recently Added</option>
          <option value="title" style={styles.sortOption}>Title A–Z</option>
          <option value="size" style={styles.sortOption}>Largest First</option>
          <option value="progress" style={styles.sortOption}>Download Progress</option>
        </select>

        {/* View toggle */}
        <div style={styles.viewToggle}>
          <button
            onClick={() => setViewMode('grid')}
            style={viewMode === 'grid' ? styles.viewToggleBtnActive : styles.viewToggleBtn}
            title="Grid view"
            aria-pressed={viewMode === 'grid'}
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            style={viewMode === 'list' ? styles.viewToggleBtnActive : styles.viewToggleBtn}
            title="List view"
            aria-pressed={viewMode === 'list'}
          >
            <ListIcon size={16} />
          </button>
        </div>
      </div>

      {/* Genre filter chips */}
      {!loading && allGenres.length > 0 && activeFilter !== 'other' && activeFilter !== 'downloading' && activeFilter !== 'library' && activeFilter !== 'unmapped' && (
        <div style={styles.genreFilters}>
          <button
            onClick={() => setActiveGenre(null)}
            style={activeGenre === null ? styles.genreChipActive : styles.genreChip}
          >
            All Genres
          </button>
          {allGenres.map(g => (
            <button
              key={g}
              onClick={() => setActiveGenre(activeGenre === g ? null : g)}
              style={activeGenre === g ? styles.genreChipActive : styles.genreChip}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {/* Continue Watching */}
      {!loading && continueWatching.length > 0 && activeFilter !== 'library' && (
        <div>
          <h2 style={styles.sectionHeading}>Continue Watching</h2>
          <div style={styles.continueRow}>
            {continueWatching.map((item) => {
              const pct = Math.min(100, Math.round((item.progressSecs / item.durationSecs) * 100));
              const remaining = Math.max(0, item.durationSecs - item.progressSecs);
              return (
                <div
                  key={`${item.torrentId}:${item.fileId}`}
                  className="glass-panel glass-card"
                  style={styles.continueCard}
                  onClick={() => handleResumePlay(item)}
                >
                  <div style={styles.continuePosterWrap}>
                    {item.torrent.metadata.posterPath ? (
                      <img src={item.torrent.metadata.posterPath} alt={item.torrent.metadata.title} style={styles.continuePoster} />
                    ) : (
                      <div style={styles.continueNoPoster}>
                        {item.torrent.metadata.type === 'tv' ? <Tv size={28} /> : <Film size={28} />}
                      </div>
                    )}
                    <div className="sv-continue-play" style={styles.continuePlayBtn}>
                      <Play size={18} fill="currentColor" color="#07070a" />
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); dismissContinueItem(item); }}
                      style={styles.continueDismissBtn}
                      title="Mark as watched"
                    >
                      <X size={12} />
                    </button>
                    <div style={styles.continueProgressBar}>
                      <div style={{ ...styles.continueProgressFill, width: `${pct}%` }} />
                    </div>
                  </div>
                  <div style={styles.continueInfo}>
                    <p style={styles.continueTitle}>{item.torrent.metadata.title}</p>
                    <p style={styles.continueMeta}>{formatTime(item.progressSecs)} · {remaining > 60 ? `${Math.round(remaining / 60)}m left` : 'Almost done'}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Watchlist */}
      {!loading && watchlistItems.length > 0 && activeFilter !== 'library' && (
        <div>
          <h2 style={styles.sectionHeading}>My Watchlist</h2>
          <div style={styles.continueRow}>
            {watchlistItems.map((torrent) => (
              <div
                key={torrent.id}
                className="glass-panel glass-card"
                style={styles.continueCard}
                onClick={() => setSelectedTorrent(torrent)}
              >
                <div style={styles.continuePosterWrap}>
                  {torrent.metadata.posterPath ? (
                    <img src={torrent.metadata.posterPath} alt={torrent.metadata.title} style={styles.continuePoster} />
                  ) : (
                    <div style={styles.continueNoPoster}>
                      {torrent.metadata.type === 'tv' ? <Tv size={28} /> : <Film size={28} />}
                    </div>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleWatchlist(torrent.id); }}
                    style={styles.continueWatchlistBtn}
                    title="Remove from Watchlist"
                  >
                    <Heart size={12} fill="var(--accent-primary)" color="var(--accent-primary)" />
                  </button>
                </div>
                <div style={styles.continueInfo}>
                  <p style={styles.continueTitle}>{torrent.metadata.title}</p>
                  <p style={styles.continueMeta}>
                    {torrent.metadata.parsed.year || (torrent.metadata.releaseDate ? torrent.metadata.releaseDate.slice(0, 4) : '')}
                    {torrent.metadata.type === 'tv' ? ' · TV' : ' · Movie'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recently Added */}
      {!loading && recentlyAdded.length > 0 && activeFilter !== 'library' && (
        <div>
          <h2 style={styles.sectionHeading}>Recently Added</h2>
          <div style={styles.continueRow}>
            {recentlyAdded.map((torrent) => (
              <div
                key={torrent.id}
                className="glass-panel glass-card"
                style={styles.continueCard}
                onClick={() => setSelectedTorrent(torrent)}
              >
                <div style={styles.continuePosterWrap}>
                  {torrent.metadata.posterPath ? (
                    <img src={torrent.metadata.posterPath} alt={torrent.metadata.title} style={styles.continuePoster} />
                  ) : (
                    <div style={styles.continueNoPoster}>
                      {torrent.metadata.type === 'tv' ? <Tv size={28} /> : <Film size={28} />}
                    </div>
                  )}
                  <div className="sv-continue-play" style={styles.continuePlayBtn}>
                    <Play size={18} fill="currentColor" color="#07070a" />
                  </div>
                  {!torrent.ready && (
                    <div style={styles.continueProgressBar}>
                      <div style={{ ...styles.continueProgressFill, width: `${torrent.progress}%` }} />
                    </div>
                  )}
                </div>
                <div style={styles.continueInfo}>
                  <p style={styles.continueTitle}>{torrent.metadata.title}</p>
                  <p style={styles.continueMeta}>
                    {torrent.ready
                      ? torrent.metadata.type === 'tv' ? 'TV Show' : 'Movie'
                      : `${Math.round(torrent.progress)}% downloading`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Local Media */}
      {!loading && localFiles.length > 0 && activeFilter !== 'library' && (
        <div>
          <h2 style={styles.sectionHeading}>Local Media</h2>
          <div style={styles.continueRow}>
            {localFiles.map((filename) => (
              <div
                key={filename}
                className="glass-panel glass-card"
                style={styles.continueCard}
                onClick={() => onPlay(`local:${filename}`, 0, filename, [], [], { title: filename, type: 'movie' as const, parsed: {} })}
              >
                <div style={styles.continuePosterWrap}>
                  <div style={styles.continueNoPoster}>
                    <Film size={28} />
                  </div>
                  <div className="sv-continue-play" style={styles.continuePlayBtn}>
                    <Play size={18} fill="currentColor" color="#07070a" />
                  </div>
                </div>
                <div style={styles.continueInfo}>
                  <p style={styles.continueTitle} title={filename}>{filename}</p>
                  <p style={styles.continueMeta}>Local File</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* My Library tab content */}
      {activeFilter === 'library' && (
        <div>
          {/* Search bar for adding to library */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
              <select
                value={libSearchType}
                onChange={e => { setLibSearchType(e.target.value as 'movie' | 'tv'); setLibSearchResults([]); setLibSearchError(''); }}
                className="glass-input"
                style={{ width: '110px', flexShrink: 0 }}
              >
                <option value="movie">Movie</option>
                <option value="tv">TV Show</option>
              </select>
              <div style={{ display: 'flex', gap: '8px', flexGrow: 1 }}>
                <input
                  type="text"
                  value={libSearchQuery}
                  onChange={e => setLibSearchQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleLibSearch(); }}
                  placeholder="Search TMDb to add to library…"
                  className="glass-input"
                  style={{ flexGrow: 1 }}
                />
                <button
                  onClick={handleLibSearch}
                  className="glass-button glass-button-primary"
                  style={{ padding: '10px 16px', flexShrink: 0 }}
                  disabled={libSearching || !libSearchQuery.trim()}
                >
                  {libSearching ? <Loader2 size={16} className="spinner" /> : <Search size={16} />}
                </button>
              </div>
            </div>
            {libSearchError && <p style={{ color: 'var(--error)', fontSize: '13px' }}>{libSearchError}</p>}
            {libSearchResults.length > 0 && (
              <div style={styles.searchResults}>
                {libSearchResults.map(result => {
                  const title = result.title || result.name || 'Untitled';
                  const date = result.release_date || result.first_air_date;
                  const inLib = libInDB.has(result.id);
                  return (
                    <div key={result.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ ...styles.searchResult, flexGrow: 1, cursor: 'default' }}>
                        {result.poster_path ? (
                          <img src={`https://image.tmdb.org/t/p/w92${result.poster_path}`} alt={title} style={styles.searchResultPoster} />
                        ) : (
                          <div style={styles.searchResultNoPoster}><Film size={16} /></div>
                        )}
                        <div style={styles.searchResultInfo}>
                          <span style={styles.searchResultTitle}>{title} {date ? `(${date.slice(0, 4)})` : ''}</span>
                          <span style={styles.searchResultOverview}>
                            {result.overview ? result.overview.slice(0, 90) + (result.overview.length > 90 ? '…' : '') : 'No description.'}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => inLib
                          ? handleRemoveFromLibrary(result.id, title)
                          : handleAddToLibrary(result, libSearchType)
                        }
                        className="glass-button"
                        style={{ flexShrink: 0, padding: '8px 12px', color: inLib ? 'var(--accent-primary)' : undefined }}
                        title={inLib ? 'Remove from library' : 'Add to library'}
                      >
                        {inLib ? <BookmarkCheck size={16} /> : <BookmarkPlus size={16} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Library items grid */}
          {filteredLocalLibrary.length === 0 ? (
            <div className="glass-panel" style={styles.emptyContainer}>
              <BookmarkPlus size={36} color="var(--text-muted)" />
              <h3>Your library is empty</h3>
              <p style={{ color: 'var(--text-secondary)' }}>
                Search above to add movies and TV shows you want to watch via VidKing or VidSrc.
              </p>
            </div>
          ) : (
            <div style={styles.grid} className="sv-grid">
              {filteredLocalLibrary.map(item => (
                <div
                  key={item.tmdbId}
                  className="glass-panel glass-card"
                  style={styles.card}
                  onClick={() => item.type === 'tv'
                    ? openLibPicker({ tmdbId: item.tmdbId, title: item.title, posterPath: item.posterPath, defaultSeason: item.season || 1 })
                    : playLibraryItem(item)
                  }
                >
                  <div style={styles.posterWrapper}>
                    {item.posterPath ? (
                      <img src={item.posterPath} alt={item.title} style={styles.poster} />
                    ) : (
                      <div style={styles.noPoster}>
                        {item.type === 'tv' ? <Tv size={36} /> : <Film size={36} />}
                        <span style={styles.noPosterTitle}>{item.title}</span>
                      </div>
                    )}
                    <div style={styles.cardOverlayTop}>
                      <span style={styles.typeBadge}>{item.type === 'tv' ? 'TV' : 'Movie'}</span>
                    </div>
                    <div style={styles.playOverlay} className="play-overlay">
                      <div style={styles.playOverlayCircle} className="play-overlay-circle">
                        <Play size={24} color="#07070a" fill="#07070a" />
                      </div>
                    </div>
                  </div>
                  <div style={styles.cardDetails}>
                    <h3 style={styles.cardTitle} title={item.title}>{item.title}</h3>
                    <div style={styles.cardSubText}>
                      <span style={{ color: 'var(--accent-primary)', fontSize: '11px' }}>VidKing / VidSrc</span>
                      {item.lastPlayedAt && (
                        <>
                          <span style={styles.cardDot}>•</span>
                          <span>Played</span>
                        </>
                      )}
                    </div>
                    <div style={styles.cardActionsRow} onClick={e => e.stopPropagation()}>
                      <span style={styles.filesCount}>
                        {item.type === 'tv' && item.season != null ? `S${item.season}E${item.episode ?? 1}` : 'Movie'}
                      </span>
                      <button
                        onClick={() => handleRemoveFromLibrary(item.tmdbId, item.title)}
                        style={{ ...styles.remapBtn, color: 'var(--error)' }}
                        title="Remove from library"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Batch actions */}
      {activeFilter !== 'library' && selectedIds.size > 0 && (
        <div className="glass-panel" style={styles.batchBar}>
          <span style={{ fontSize: '13px', fontWeight: 600 }}>{selectedIds.size} selected</span>
          <button onClick={openBatchRemap} className="glass-button" style={{ padding: '8px 14px', fontSize: '13px' }}>
            <Settings size={14} /> Remap selected
          </button>
          <button onClick={clearSelection} className="glass-button" style={{ padding: '8px 14px', fontSize: '13px' }}>
            <X size={14} /> Clear
          </button>
        </div>
      )}

      {/* Main Grid Content */}
      {activeFilter !== 'library' && (loading ? (
        <div style={styles.centerStatus}>
          <Loader2 size={40} className="spinner" />
          <p style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>{loadingMessage}</p>
        </div>
      ) : error ? (
        <div style={styles.centerStatus}>
          <div className="glass-panel" style={styles.errorContainer}>
            <h3 style={{ color: 'var(--error)' }}>Error Loading Library</h3>
            <p style={{ marginTop: '8px', color: 'var(--text-secondary)' }}>{error}</p>
            <button
              onClick={() => fetchLibrary()}
              className="glass-button glass-button-primary"
              style={{ marginTop: '16px' }}
            >
              Retry Connection
            </button>
          </div>
        </div>
      ) : filteredLibrary.length === 0 ? (
        <div className="glass-panel" style={styles.emptyContainer}>
          <SlidersHorizontal size={36} color="var(--text-muted)" />
          <h3>No media found</h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            {debouncedQuery ? 'Try adjusting your search query' : 'Your TorBox account is empty or no video torrents are cached.'}
          </p>
        </div>
      ) : viewMode === 'list' ? (
        <div className="sv-list">
          {filteredLibrary.map((torrent) => {
            const isCompleted = torrent.ready;
            const meta = torrent.metadata;
            const isLibraryOnly = torrent.videoFiles.length === 0 && !!meta.tmdbId;
            return (
              <div
                key={torrent.id}
                className={`sv-list-row${selectedIds.has(torrent.id) ? ' sv-list-row-selected' : ''}`}
                onClick={() => isLibraryOnly
                  ? (meta.type === 'tv'
                      ? openLibPicker({ tmdbId: meta.tmdbId!, title: meta.title, posterPath: meta.posterPath, defaultSeason: meta.parsed?.season || 1 })
                      : onPlay(undefined, undefined, '', [], [], meta))
                  : setSelectedTorrent(torrent)
                }
              >
                <button
                  className="sv-list-check"
                  onClick={(e) => { e.stopPropagation(); toggleSelected(torrent.id); }}
                  title={selectedIds.has(torrent.id) ? 'Deselect' : 'Select'}
                >
                  {selectedIds.has(torrent.id)
                    ? <SquareCheck size={18} color="var(--accent-primary)" />
                    : <Square size={18} />}
                </button>
                {meta.posterPath ? (
                  <img className="sv-list-poster" src={meta.posterPath} alt="" />
                ) : (
                  <div className="sv-list-poster sv-list-poster-fallback">
                    {meta.type === 'tv' ? <Tv size={18} /> : <Film size={18} />}
                  </div>
                )}
                <div className="sv-list-main">
                  <p className="sv-list-title">{meta.title}</p>
                  <p className="sv-list-meta">
                    {meta.parsed.year || (meta.releaseDate ? meta.releaseDate.slice(0, 4) : 'No Year')}
                    {meta.type === 'tv' ? ' · TV' : ' · Movie'}
                    {torrent.badges && torrent.badges.length > 0 ? ` · ${torrent.badges.length} badge(s)` : ''}
                  </p>
                </div>
                <div className="sv-list-status">
                  {isLibraryOnly ? (
                    <><SlidersHorizontal size={14} color="var(--accent-primary)" /><span>Sources</span></>
                  ) : isCompleted ? (
                    <><CheckCircle2 size={14} color="var(--success)" /><span>Ready</span></>
                  ) : (
                    <><ArrowDownCircle size={14} className="spinner" /><span>{Math.round(torrent.progress)}%</span></>
                  )}
                </div>
                <div className="sv-list-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => toggleWatchlist(torrent.id)}
                    title={watchlist.has(torrent.id) ? 'Remove from Watchlist' : 'Add to Watchlist'}
                    style={{ ...styles.remapBtn, color: watchlist.has(torrent.id) ? 'var(--accent-primary)' : undefined }}
                  >
                    <Heart size={14} fill={watchlist.has(torrent.id) ? 'currentColor' : 'none'} />
                  </button>
                  <button onClick={() => openRemapModal(torrent)} style={styles.remapBtn} title="Remap / fix metadata">
                    <Settings size={14} />
                  </button>
                  <span style={styles.filesCount}>{torrent.videoFiles.length} file(s)</span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={styles.grid} className="sv-grid">
          {filteredLibrary.map((torrent) => {
            const isCompleted = torrent.ready;
            const meta = torrent.metadata;
            const isLibraryOnly = torrent.videoFiles.length === 0 && !!meta.tmdbId;
            return (
              <div
                key={torrent.id}
                className="glass-panel glass-card"
                style={styles.card}
                onClick={() => isLibraryOnly
                  ? (meta.type === 'tv'
                      ? openLibPicker({ tmdbId: meta.tmdbId!, title: meta.title, posterPath: meta.posterPath, defaultSeason: meta.parsed?.season || 1 })
                      : onPlay(undefined, undefined, '', [], [], meta))
                  : setSelectedTorrent(torrent)
                }
              >
                {/* Poster Display */}
                <div style={styles.posterWrapper}>
                  {/* Batch select */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleSelected(torrent.id); }}
                    style={styles.selectBtn}
                    title={selectedIds.has(torrent.id) ? 'Deselect' : 'Select for batch actions'}
                  >
                    {selectedIds.has(torrent.id)
                      ? <SquareCheck size={18} color="var(--accent-primary)" />
                      : <Square size={18} />}
                  </button>
                  {meta.posterPath ? (
                    <img src={meta.posterPath} alt={meta.title} style={styles.poster} />
                  ) : (
                    <div style={styles.noPoster}>
                      {meta.type === 'tv' ? <Tv size={36} /> : <Film size={36} />}
                      <span style={styles.noPosterTitle}>{meta.title}</span>
                    </div>
                  )}

                  {/* Rating / Badges Overlay */}
                  <div style={styles.cardOverlayTop}>
                    <span style={styles.typeBadge}>
                      {!torrent.isMedia ? 'Other' : meta.type === 'tv' ? 'TV' : 'Movie'}
                    </span>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      {isLibraryOnly && (
                        <span style={styles.typeBadge}>Sources</span>
                      )}
                      {meta.rating ? (
                        <span style={styles.ratingBadge}>
                          ★ {meta.rating.toFixed(1)}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {/* Play Hover overlay */}
                  <div style={styles.playOverlay} className="play-overlay">
                    <div style={styles.playOverlayCircle} className="play-overlay-circle">
                      {isLibraryOnly
                        ? <Play size={24} color="#07070a" fill="#07070a" />
                        : <Eye size={24} color="#07070a" />
                      }
                    </div>
                  </div>
                </div>

                {/* Card Info Details */}
                <div style={styles.cardDetails}>
                  <h3 style={styles.cardTitle} title={meta.title}>{meta.title}</h3>

                  {torrent.badges && torrent.badges.length > 0 && (
                    <div style={{ marginBottom: '4px' }}>
                      <BadgeBar badges={torrent.badges} max={4} />
                    </div>
                  )}

                  <div style={styles.cardSubText}>
                    <span>{meta.parsed.year || (meta.releaseDate ? meta.releaseDate.slice(0, 4) : 'No Year')}</span>
                    <span style={styles.cardDot}>•</span>
                    {resumableTorrents.has(torrent.id) && (
                      <>
                        <span style={styles.resumeChip}>Resume</span>
                        <span style={styles.cardDot}>•</span>
                      </>
                    )}
                    <span style={{
                      color: isLibraryOnly ? 'var(--accent-primary)' : isCompleted ? 'var(--success)' : 'var(--warning)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}>
                      {isLibraryOnly ? (
                        'Stream via sources'
                      ) : isCompleted ? (
                        <>
                          <CheckCircle2 size={12} /> Ready
                        </>
                      ) : (
                        <>
                          <ArrowDownCircle size={12} className="spinner" /> {Math.round(torrent.progress)}%
                        </>
                      )}
                    </span>
                  </div>

                  {/* Download Progress Bar */}
                  {!isCompleted && !isLibraryOnly && (
                    <div style={styles.progressBarBg}>
                      <div
                        style={{
                          ...styles.progressBarFill,
                          width: `${torrent.progress}%`
                        }}
                      />
                    </div>
                  )}
                  
                  {/* Action Settings Row */}
                  <div style={styles.cardActionsRow} onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => openRemapModal(torrent)}
                      style={styles.remapBtn}
                      title="Fix metadata / Remap TMDb ID"
                    >
                      <Settings size={14} />
                      <span>Remap</span>
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {resumableTorrents.has(torrent.id) && (
                        <button
                          onClick={() => markTorrentWatched(torrent.id)}
                          style={styles.remapBtn}
                          title="Mark as watched"
                        >
                          <EyeOff size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => toggleWatchlist(torrent.id)}
                        style={{
                          ...styles.remapBtn,
                          color: watchlist.has(torrent.id) ? 'var(--accent-primary)' : undefined,
                        }}
                        title={watchlist.has(torrent.id) ? 'Remove from Watchlist' : 'Add to Watchlist'}
                      >
                        <Heart size={14} fill={watchlist.has(torrent.id) ? 'currentColor' : 'none'} />
                      </button>
                      <span style={styles.filesCount}>{torrent.videoFiles.length} file(s)</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* Detail overlay Modal */}
      {selectedTorrent && (
        <DetailModal
          torrent={selectedTorrent}
          sources={selectedTorrent.sources}
          onClose={() => setSelectedTorrent(null)}
          onPlay={(torrentId, fileId, filename, subtitles, videoFiles) => {
            onPlay(
              torrentId,
              fileId,
              filename,
              subtitles,
              videoFiles,
              selectedTorrent.metadata
            );
            setSelectedTorrent(null);
          }}
        />
      )}

      {/* Toast Notifications */}
      {toast && (
        <div style={{
          ...styles.successToast,
          borderColor: toast.type === 'error'
            ? 'rgba(255,77,77,0.3)'
            : toast.type === 'info'
              ? 'rgba(0,242,254,0.3)'
              : 'rgba(34,197,94,0.3)',
        }}>
          {toast.type === 'error'
            ? <AlertCircle size={16} color="var(--error)" />
            : toast.type === 'info'
              ? <Info size={16} color="var(--accent-primary)" />
              : <CheckCircle2 size={16} color="var(--success)" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Library TV Episode Picker Modal */}
      {libPickerState && (
        <div style={styles.modalBackdrop} onClick={closeLibPicker} role="dialog" aria-modal="true">
          <div
            className="glass-panel"
            style={styles.pickerCard}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={styles.modalHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {libPickerState.posterPath && (
                  <img src={libPickerState.posterPath} alt={libPickerState.title} style={styles.pickerPoster} />
                )}
                <div>
                  <h3 style={{ fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)' }}>
                    {libPickerState.title}
                  </h3>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>Select an episode to watch</p>
                </div>
              </div>
              <button type="button" onClick={closeLibPicker} style={styles.modalCloseBtn}>
                <X size={18} />
              </button>
            </div>

            {/* Season selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <label style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary)', flexShrink: 0 }}>Season</label>
              <select
                value={libPickerSeason}
                onChange={(e) => { setLibPickerSeason(parseInt(e.target.value, 10)); setLibPickerEpisodes([]); setLibPickerError(''); }}
                className="glass-input"
                style={{ padding: '8px 12px', fontSize: '14px', borderRadius: '8px', cursor: 'pointer', width: '150px' }}
              >
                {Array.from({ length: 20 }, (_, i) => i + 1).map(s => (
                  <option key={s} value={s} style={{ background: '#12121c', color: '#fff' }}>Season {s}</option>
                ))}
              </select>
            </div>

            {/* Episodes list */}
            <div style={styles.pickerEpisodesList}>
              {libPickerLoading && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '32px', color: 'var(--text-secondary)' }}>
                  <Loader2 size={20} className="spinner" />
                  <span>Loading episodes…</span>
                </div>
              )}
              {!libPickerLoading && libPickerError && libPickerEpisodes.length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '24px', color: 'var(--text-muted)', justifyContent: 'center' }}>
                  <Info size={18} />
                  <span>{libPickerError}</span>
                </div>
              )}
              {!libPickerLoading && libPickerEpisodes.map(ep => (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => playLibraryEpisode(ep)}
                  style={styles.pickerEpisodeRow}
                  className="lib-picker-ep"
                >
                  {ep.still_path ? (
                    <img
                      src={`https://image.tmdb.org/t/p/w185${ep.still_path}`}
                      alt={ep.name}
                      style={styles.pickerStill}
                    />
                  ) : (
                    <div style={styles.pickerStillFallback}>
                      <Tv size={18} color="var(--text-muted)" />
                    </div>
                  )}
                  <div style={styles.pickerEpInfo}>
                    <span style={styles.pickerEpNum}>E{ep.episode_number}</span>
                    <span style={styles.pickerEpTitle}>{ep.name}</span>
                    {ep.overview && (
                      <span style={styles.pickerEpOverview}>
                        {ep.overview.length > 120 ? ep.overview.slice(0, 120) + '…' : ep.overview}
                      </span>
                    )}
                  </div>
                  <ChevronRight size={18} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Remap Mapping Modal */}
      {remapTorrent && (
        <div style={styles.modalBackdrop} onClick={closeRemapModal} role="dialog" aria-modal="true">
          <form
            onSubmit={handleRemapSubmit}
            className="glass-panel"
            style={styles.remapCard}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <h3 style={{ fontSize: '18px' }}>Fix Metadata</h3>
              <button
                type="button"
                onClick={closeRemapModal}
                style={styles.modalCloseBtn}
              >
                <X size={18} />
              </button>
            </div>

            <p style={styles.modalSubtitle}>
              Remap torrent: <br/>
              <strong style={{ color: '#fff', fontSize: '13px', wordBreak: 'break-all' }}>
                {remapTorrent.name}
              </strong>
            </p>

            <div style={styles.formGroup}>
              <label style={styles.label}>Content Type</label>
              <div style={styles.radioGroup}>
                <label style={styles.radioLabel}>
                  <input
                    type="radio"
                    name="remapType"
                    checked={remapType === 'movie'}
                    onChange={() => setRemapType('movie')}
                    disabled={remapSubmitting}
                  />
                  <span>Movie</span>
                </label>
                <label style={styles.radioLabel}>
                  <input
                    type="radio"
                    name="remapType"
                    checked={remapType === 'tv'}
                    onChange={() => setRemapType('tv')}
                    disabled={remapSubmitting}
                  />
                  <span>TV Show</span>
                </label>
                <label style={styles.radioLabel}>
                  <input
                    type="radio"
                    name="remapType"
                    checked={remapType === 'other'}
                    onChange={() => {
                      setRemapType('other');
                      setRemapTmdbId('0');
                    }}
                    disabled={remapSubmitting}
                  />
                  <span>Other (Game/Software)</span>
                </label>
              </div>
            </div>

            {remapType !== 'other' && (
            <>
            <div style={styles.formGroup}>
              <label style={styles.label}>Search TMDb</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={remapQuery}
                  onChange={(e) => setRemapQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleRemapSearch();
                    }
                  }}
                  placeholder="Search by title..."
                  className="glass-input"
                  style={{ flexGrow: 1 }}
                  disabled={remapSubmitting}
                />
                <button
                  type="button"
                  onClick={handleRemapSearch}
                  className="glass-button"
                  style={{ padding: '10px 16px' }}
                  disabled={remapSearching || remapSubmitting || !remapQuery.trim()}
                >
                  {remapSearching ? <Loader2 size={16} className="spinner" /> : <Search size={16} />}
                </button>
              </div>
            </div>

            {remapResults.length > 0 && (
              <div style={styles.searchResults}>
                {remapResults.map((result) => {
                  const title = result.title || result.name || 'Untitled';
                  const date = result.release_date || result.first_air_date;
                  const isSelected = remapTmdbId === String(result.id);
                  return (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => setRemapTmdbId(String(result.id))}
                      style={isSelected ? styles.searchResultActive : styles.searchResult}
                    >
                      {result.poster_path ? (
                        <img
                          src={`https://image.tmdb.org/t/p/w92${result.poster_path}`}
                          alt={title}
                          style={styles.searchResultPoster}
                        />
                      ) : (
                        <div style={styles.searchResultNoPoster}>
                          <Film size={16} />
                        </div>
                      )}
                      <div style={styles.searchResultInfo}>
                        <span style={styles.searchResultTitle}>
                          {title} {date ? `(${date.slice(0, 4)})` : ''}
                        </span>
                        <span style={styles.searchResultOverview}>
                          {result.overview ? result.overview.slice(0, 90) + (result.overview.length > 90 ? '…' : '') : 'No description.'}
                        </span>
                      </div>
                      {isSelected && <CheckCircle2 size={18} color="var(--accent-primary)" style={{ flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
            )}

            <div style={styles.formGroup}>
              <label style={styles.label}>TMDb ID</label>
              <input
                type="number"
                value={remapTmdbId}
                onChange={(e) => setRemapTmdbId(e.target.value)}
                placeholder="Pick a result above, or paste an ID"
                className="glass-input"
                style={{ width: '100%' }}
                required
                disabled={remapSubmitting}
              />
            </div>
            </>
            )}

            {remapError && <div style={styles.modalError}>{remapError}</div>}

            <div style={styles.modalActions}>
              <button
                type="button"
                onClick={closeRemapModal}
                className="glass-button"
                disabled={remapSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="glass-button glass-button-primary"
                disabled={remapSubmitting || !remapTmdbId}
              >
                {remapSubmitting ? 'Updating...' : 'Update Map'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  sectionHeading: {
    fontSize: '18px',
    fontWeight: '700',
    color: 'var(--text-primary)',
    marginBottom: '16px',
    letterSpacing: '-0.01em',
  },
  continueRow: {
    display: 'flex',
    gap: '16px',
    overflowX: 'auto',
    paddingBottom: '8px',
  },
  continueCard: {
    flexShrink: 0,
    width: '160px',
    borderRadius: '12px',
    overflow: 'hidden',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
  },
  continuePosterWrap: {
    position: 'relative',
    width: '100%',
    aspectRatio: '2/3',
    overflow: 'hidden',
    background: 'rgba(255,255,255,0.02)',
  },
  continuePoster: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  continueNoPoster: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    background: 'rgba(20,20,30,0.9)',
  },
  continuePlayBtn: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    background: 'var(--accent-primary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: 'var(--shadow-glow)',
    opacity: 0,
    transition: 'opacity 0.2s',
  },
  continueProgressBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: '100%',
    height: '3px',
    background: 'rgba(255,255,255,0.15)',
  },
  continueProgressFill: {
    height: '100%',
    background: 'var(--accent-gradient)',
  },
  continueInfo: {
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  continueTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  continueMeta: {
    fontSize: '11px',
    color: 'var(--text-muted)',
  },
  page: {
    padding: '32px',
    maxWidth: '1200px',
    width: '100%',
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 28px',
    borderRadius: '16px',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  brandTitle: {
    fontSize: '20px',
    fontWeight: '700',
    fontFamily: 'var(--font-display)',
    letterSpacing: '-0.01em',
  },
  headerActions: {
    display: 'flex',
    gap: '12px',
  },
  headerBtn: {
    padding: '8px 16px',
    fontSize: '14px',
    borderRadius: '8px',
  },
  logoutBtn: {
    padding: '8px 16px',
    fontSize: '14px',
    borderRadius: '8px',
    background: 'rgba(255, 77, 77, 0.05)',
    borderColor: 'rgba(255, 77, 77, 0.1)',
    color: '#ff4d4d',
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '20px',
    flexWrap: 'wrap',
  },
  searchWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    flexGrow: 1,
    maxWidth: '480px',
    minWidth: '280px',
  },
  searchIcon: {
    position: 'absolute',
    left: '16px',
    color: 'var(--text-muted)',
    pointerEvents: 'none',
  },
  searchClearBtn: {
    position: 'absolute',
    right: '10px',
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    padding: '4px',
    borderRadius: '4px',
  },
  searchInput: {
    width: '100%',
    paddingLeft: '48px',
  },
  filters: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
  },
  sortSelect: {
    padding: '10px 14px',
    fontSize: '14px',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  sortOption: {
    background: '#12121c',
    color: '#fff',
  },
  filterBtn: {
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid var(--glass-border)',
    color: 'var(--text-secondary)',
    padding: '10px 18px',
    borderRadius: '8px',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'var(--transition-smooth)',
  },
  filterBtnActive: {
    background: 'var(--accent-gradient)',
    border: '1px solid transparent',
    color: 'var(--bg-dark)',
    fontWeight: '600',
    padding: '10px 18px',
    borderRadius: '8px',
    fontSize: '14px',
    cursor: 'pointer',
    boxShadow: 'var(--shadow-glow)',
    transition: 'var(--transition-smooth)',
  },
  centerStatus: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '100px 0',
  },
  errorContainer: {
    maxWidth: '440px',
    padding: '32px',
    textAlign: 'center',
  },
  emptyContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '80px 40px',
    textAlign: 'center',
    borderStyle: 'dashed',
    borderColor: 'var(--glass-border)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '24px',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    cursor: 'pointer',
    borderRadius: '16px',
  },
  posterWrapper: {
    position: 'relative',
    width: '100%',
    aspectRatio: '2/3',
    overflow: 'hidden',
    background: 'rgba(255, 255, 255, 0.01)',
  },
  poster: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transition: 'var(--transition-smooth)',
  },
  noPoster: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    background: 'linear-gradient(135deg, rgba(20, 20, 30, 0.7) 0%, rgba(10, 10, 15, 0.9) 100%)',
    color: 'var(--text-muted)',
    padding: '16px',
    textAlign: 'center',
  },
  noPosterTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
  },
  cardOverlayTop: {
    position: 'absolute',
    top: '12px',
    left: '12px',
    right: '12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    pointerEvents: 'none',
  },
  typeBadge: {
    fontSize: '9px',
    fontWeight: '700',
    background: 'rgba(0, 0, 0, 0.75)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: 'var(--accent-primary)',
    padding: '3px 8px',
    borderRadius: '4px',
    textTransform: 'uppercase',
  },
  ratingBadge: {
    fontSize: '10px',
    fontWeight: '700',
    background: 'rgba(0, 0, 0, 0.75)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: 'var(--warning)',
    padding: '3px 8px',
    borderRadius: '4px',
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    background: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0,
    transition: 'var(--transition-smooth)',
  },
  playOverlayCircle: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    background: 'var(--accent-primary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transform: 'scale(0.8)',
    transition: 'var(--transition-smooth)',
    boxShadow: 'var(--shadow-glow)',
  },
  // We'll simulate :hover inside the browser or handle it via card:hover in CSS
  // But CSS hover automatically scales playOverlay in our stylesheet if we define it, or we can rely on standard class selectors.
  cardDetails: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  cardTitle: {
    fontSize: '15px',
    fontWeight: '600',
    color: '#ffffff',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  cardSubText: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: 'var(--text-secondary)',
  },
  cardDot: {
    color: 'var(--text-muted)',
  },
  resumeChip: {
    fontSize: '10px',
    fontWeight: 700,
    color: 'var(--accent-primary)',
    background: 'rgba(0, 242, 254, 0.08)',
    border: '1px solid rgba(0, 242, 254, 0.25)',
    padding: '1px 6px',
    borderRadius: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  progressBarBg: {
    width: '100%',
    height: '3px',
    background: 'rgba(255, 255, 255, 0.1)',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    background: 'var(--accent-gradient)',
  },
  cardActionsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '6px',
    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
    paddingTop: '8px',
  },
  remapBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'var(--transition-smooth)',
    outline: 'none',
  },
  filesCount: {
    fontSize: '11px',
    color: 'var(--text-muted)',
  },
  successToast: {
    position: 'fixed',
    bottom: '32px',
    right: '32px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '12px 20px',
    background: 'rgba(18, 18, 28, 0.97)',
    border: '1px solid rgba(34, 197, 94, 0.3)',
    borderRadius: '10px',
    fontSize: '14px',
    color: 'var(--text-primary)',
    zIndex: 3000,
    backdropFilter: 'blur(8px)',
    boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
  },
  modalBackdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    background: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    padding: '24px',
  },
  remapCard: {
    maxWidth: '440px',
    width: '100%',
    padding: '32px',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalCloseBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    outline: 'none',
  },
  modalSubtitle: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    background: 'rgba(0, 0, 0, 0.3)',
    padding: '12px 16px',
    borderRadius: '8px',
    lineHeight: '1.5',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  label: {
    fontSize: '13px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
  },
  radioGroup: {
    display: 'flex',
    gap: '20px',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  modalError: {
    color: 'var(--error)',
    fontSize: '13px',
    fontWeight: '500',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '8px',
  },
  searchResults: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    maxHeight: '260px',
    overflowY: 'auto',
    paddingRight: '4px',
  },
  searchResult: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px',
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'left',
    color: 'var(--text-primary)',
    transition: 'var(--transition-smooth)',
  },
  searchResultActive: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px',
    background: 'rgba(0, 242, 254, 0.06)',
    border: '1px solid rgba(0, 242, 254, 0.3)',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'left',
    color: 'var(--text-primary)',
    transition: 'var(--transition-smooth)',
  },
  searchResultPoster: {
    width: '40px',
    height: '60px',
    objectFit: 'cover',
    borderRadius: '4px',
    flexShrink: 0,
  },
  searchResultNoPoster: {
    width: '40px',
    height: '60px',
    borderRadius: '4px',
    background: 'rgba(255, 255, 255, 0.05)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  searchResultInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
    flexGrow: 1,
  },
  searchResultTitle: {
    fontSize: '13px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  searchResultOverview: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    lineHeight: 1.4,
  },
  genreFilters: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap' as const,
    marginTop: '-16px',
  },
  genreChip: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid var(--glass-border)',
    color: 'var(--text-muted)',
    padding: '5px 14px',
    borderRadius: '20px',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'var(--transition-smooth)',
  },
  genreChipActive: {
    background: 'rgba(0,242,254,0.1)',
    border: '1px solid rgba(0,242,254,0.3)',
    color: 'var(--accent-primary)',
    padding: '5px 14px',
    borderRadius: '20px',
    fontSize: '12px',
    cursor: 'pointer',
    fontWeight: '600',
    transition: 'var(--transition-smooth)',
  },
  continueDismissBtn: {
    position: 'absolute' as const,
    top: '6px',
    right: '6px',
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.7)',
    border: '1px solid rgba(255,255,255,0.15)',
    color: 'rgba(255,255,255,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    zIndex: 5,
    padding: 0,
  },
  continueWatchlistBtn: {
    position: 'absolute' as const,
    top: '6px',
    right: '6px',
    width: '22px',
    height: '22px',
    borderRadius: '50%',
    background: 'rgba(0,0,0,0.7)',
    border: '1px solid rgba(0,242,254,0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    zIndex: 5,
    padding: 0,
  },
  pickerCard: {
    maxWidth: '560px',
    width: '100%',
    maxHeight: '85vh',
    padding: '28px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    overflowY: 'hidden',
  },
  pickerPoster: {
    width: '48px',
    height: '72px',
    objectFit: 'cover' as const,
    borderRadius: '6px',
    border: '1px solid rgba(255,255,255,0.1)',
    flexShrink: 0,
  },
  pickerEpisodesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    overflowY: 'auto',
    flex: 1,
    paddingRight: '4px',
  },
  pickerEpisodeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '10px',
    cursor: 'pointer',
    textAlign: 'left' as const,
    color: 'var(--text-primary)',
    transition: 'var(--transition-smooth)',
    width: '100%',
  },
  pickerStill: {
    width: '80px',
    height: '45px',
    objectFit: 'cover' as const,
    borderRadius: '6px',
    flexShrink: 0,
  },
  pickerStillFallback: {
    width: '80px',
    height: '45px',
    borderRadius: '6px',
    background: 'rgba(255,255,255,0.04)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pickerEpInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    flexGrow: 1,
    minWidth: 0,
  },
  pickerEpNum: {
    fontSize: '10px',
    fontWeight: '700',
    color: 'var(--accent-primary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  pickerEpTitle: {
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  pickerEpOverview: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    lineHeight: '1.4',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    overflow: 'hidden',
  },
  selectBtn: {
    position: 'absolute',
    top: '8px',
    left: '8px',
    zIndex: 3,
    background: 'rgba(7, 7, 10, 0.65)',
    border: '1px solid var(--glass-border)',
    borderRadius: '8px',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4px',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
  },
  viewToggle: {
    display: 'flex',
    gap: '4px',
    flexShrink: 0,
  },
  viewToggleBtn: {
    background: 'rgba(255, 255, 255, 0.04)',
    border: '1px solid var(--glass-border)',
    color: 'var(--text-secondary)',
    borderRadius: '8px',
    padding: '8px 10px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'var(--transition-smooth)',
  },
  viewToggleBtnActive: {
    background: 'var(--accent-gradient)',
    borderColor: 'transparent',
    color: 'var(--bg-dark)',
    borderRadius: '8px',
    padding: '8px 10px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'var(--transition-smooth)',
  },
  batchBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 16px',
    marginBottom: '16px',
    borderRadius: 'var(--border-radius-md)',
  },
};
