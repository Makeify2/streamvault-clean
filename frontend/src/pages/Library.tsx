import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, RefreshCw, Loader2, Play, Heart, Film, Tv, Settings,
  PlusCircle, X, CheckCircle2, ArrowDownCircle, LayoutGrid, List as ListIcon,
  Square, SquareCheck, BookmarkPlus, BookmarkCheck, AlertCircle, SlidersHorizontal
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { SubtitleTrack, TorrentMetadata, Torrent } from '../types';
import { type LibraryItem, addLibraryItem, removeLibraryItem, getLibraryItems } from '../lib/libraryDB';
import { apiUrl } from '../lib/api';
import { formatBytes, formatTime } from '../lib/utils';
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

type FilterMode = 'all' | 'movie' | 'tv' | 'downloading' | 'other' | 'unmapped' | 'saved';
type SortMode = 'added' | 'title' | 'size' | 'progress';

interface ToastMsg {
  message: string;
  type: 'success' | 'info' | 'error';
}

interface RemapModalProps {
  title: string;
  hashes: string[];
  initialTmdbId?: string;
  initialType: 'movie' | 'tv';
  initialQuery: string;
  onClose: () => void;
  onDone: () => void;
}

/** TMDb search + manual metadata remap for one or several torrents. */
const RemapModal: React.FC<RemapModalProps> = ({
  title, hashes, initialTmdbId, initialType, initialQuery, onClose, onDone,
}) => {
  const { token } = useAuth();
  const [query, setQuery] = useState(initialQuery);
  const [tmdbId, setTmdbId] = useState(initialTmdbId ?? '');
  const [type, setType] = useState<'movie' | 'tv'>(initialType);
  const [results, setResults] = useState<TmdbSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError('');
    try {
      const params = new URLSearchParams({ query: query.trim(), type });
      const response = await fetch(apiUrl(`/api/tmdb/search?${params}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setResults((data.data || []).slice(0, 8));
        if ((data.data || []).length === 0) setError('No TMDb results — try a different title.');
      } else {
        setError(data.detail || 'TMDb search failed.');
      }
    } catch {
      setError('Network error during search.');
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tmdbId) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(apiUrl('/api/torrents/map-manually'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ hashes, tmdbId: parseInt(tmdbId, 10), type }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        onDone();
      } else {
        setError(data.detail || 'Mapping update failed.');
      }
    } catch {
      setError('Network error trying to remap media.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="lib-modal-backdrop" onClick={onClose}>
      <div className="glass-panel lib-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lib-modal-header">
          <div>
            <h3 className="source-picker-title">Remap Metadata</h3>
            <p className="page-subtitle" style={{ fontSize: 13 }}>{title}</p>
          </div>
          <button className="source-picker-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <select
            value={type}
            onChange={(e) => { setType(e.target.value as 'movie' | 'tv'); setResults([]); }}
            className="glass-input"
            style={{ width: 110, flexShrink: 0 }}
          >
            <option value="movie">Movie</option>
            <option value="tv">TV Show</option>
          </select>
          <div style={{ display: 'flex', gap: 8, flexGrow: 1 }}>
            <input
              className="glass-input"
              style={{ flexGrow: 1 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
              placeholder="Search TMDb…"
            />
            <button className="glass-button glass-button-primary" onClick={handleSearch} disabled={searching || !query.trim()}>
              {searching ? <Loader2 size={16} className="spinner" /> : <Search size={16} />}
            </button>
          </div>
        </div>

        {error && <p style={{ color: 'var(--error)', fontSize: 13, marginBottom: 8 }}>{error}</p>}

        {results.length > 0 && (
          <div className="lib-remap-results">
            {results.map((r) => {
              const isPicked = String(r.id) === tmdbId;
              const label = r.title || r.name || 'Untitled';
              const date = r.release_date || r.first_air_date;
              return (
                <button
                  key={r.id}
                  className={`lib-remap-result${isPicked ? ' active' : ''}`}
                  onClick={() => { setTmdbId(String(r.id)); setResults([]); }}
                >
                  {r.poster_path ? (
                    <img src={`https://image.tmdb.org/t/p/w92${r.poster_path}`} alt="" />
                  ) : (
                    <div className="lib-remap-fallback"><Film size={16} /></div>
                  )}
                  <span>{label} {date ? `(${date.slice(0, 4)})` : ''}</span>
                  {isPicked && <CheckCircle2 size={16} color="var(--accent-primary)" />}
                </button>
              );
            })}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            className="glass-input"
            style={{ flexGrow: 1 }}
            value={tmdbId}
            onChange={(e) => setTmdbId(e.target.value.replace(/\D/g, ''))}
            placeholder="TMDb ID"
            inputMode="numeric"
          />
          <button className="glass-button glass-button-primary" type="submit" disabled={submitting || !tmdbId}>
            {submitting ? <Loader2 size={16} className="spinner" /> : <CheckCircle2 size={16} />}
            Save
          </button>
        </form>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
          Remapping {hashes.length} torrent hash(es) to the chosen title.
        </p>
      </div>
    </div>
  );
};/** Full in-site library: TorBox collection with discovery-style chrome. */
export const Library: React.FC = () => {
  const { token } = useAuth();
  const navigate = useNavigate();

  const [library, setLibrary] = useState<Torrent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterMode>('all');
  const [activeGenre, setActiveGenre] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('added');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [selectedTorrent, setSelectedTorrent] = useState<Torrent | null>(null);

  // Remap state
  const [remapState, setRemapState] = useState<{
    title: string; hashes: string[]; tmdbId?: string; type: 'movie' | 'tv'; query: string;
  } | null>(null);

  // Watchlist + progress
  const [watchlist, setWatchlist] = useState<Set<number>>(() => {
    try {
      const raw = localStorage.getItem('sv-watchlist');
      return raw ? new Set<number>(JSON.parse(raw)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [resumeVersion, setResumeVersion] = useState(0);

  // Saved (IndexedDB) library
  const [localLibrary, setLocalLibrary] = useState<LibraryItem[]>([]);
  const [libInDB, setLibInDB] = useState<Set<number>>(new Set());
  const [libSearchQuery, setLibSearchQuery] = useState('');
  const [libSearchType, setLibSearchType] = useState<'movie' | 'tv'>('movie');
  const [libSearchResults, setLibSearchResults] = useState<TmdbSearchResult[]>([]);
  const [libSearching, setLibSearching] = useState(false);
  const [libSearchError, setLibSearchError] = useState('');

  // Modals + toast
  const [showSettings, setShowSettings] = useState(false);
  const [showDownloadManager, setShowDownloadManager] = useState(false);
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: ToastMsg['type'] = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchLibrary = useCallback(async (isSilent = false) => {
    if (!token) return;
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const response = await fetch(apiUrl('/api/torrents'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setLibrary(data.data || []);
      } else if (response.status === 401) {
        window.dispatchEvent(new CustomEvent('sv-auth-expired'));
      } else {
        setError(data.detail || 'Failed to fetch media library.');
      }
    } catch {
      setError('Connection failure: Unable to reach streaming backend.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  const refreshLocalLibrary = useCallback(async () => {
    try {
      const items = await getLibraryItems();
      setLocalLibrary(items);
      setLibInDB(new Set(items.map((i) => i.tmdbId)));
    } catch {
      // IndexedDB unavailable
    }
  }, []);

  useEffect(() => { refreshLocalLibrary(); }, [refreshLocalLibrary]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Auto-refresh while anything is downloading
  const hasActiveDownloads = library.some((t) => !t.ready);
  useEffect(() => {
    if (!hasActiveDownloads) return;
    const interval = window.setInterval(() => fetchLibrary(true), 30000);
    return () => window.clearInterval(interval);
  }, [hasActiveDownloads, fetchLibrary]);

  // Bump version whenever the player writes/clears progress
  useEffect(() => {
    const handler = () => setResumeVersion((v) => v + 1);
    window.addEventListener('sv-progress', handler);
    return () => window.removeEventListener('sv-progress', handler);
  }, []);

  // --- Filtering / sorting ---
  const filteredLibrary = useMemo(() => {
    const query = debouncedQuery.toLowerCase();
    const filtered = library.filter((t) => {
      if (activeFilter === 'saved') return false;
      if (activeFilter === 'unmapped') return !t.metadata.tmdbId;
      if (activeFilter === 'other') return !t.isMedia;
      if (activeFilter === 'downloading') return !t.ready;
      if (activeFilter === 'movie') return t.isMedia && t.metadata.type === 'movie' && !!t.metadata.tmdbId;
      if (activeFilter === 'tv') return t.isMedia && t.metadata.type === 'tv' && !!t.metadata.tmdbId;
      if (activeFilter === 'all') {
        if (!t.isMedia) return false;
        if (!t.metadata.tmdbId) return false;
      }
      if (activeGenre && !(t.metadata.genres || []).includes(activeGenre)) return false;
      return true;
    });
    const searched = query
      ? filtered.filter((t) => t.metadata.title.toLowerCase().includes(query) || t.name.toLowerCase().includes(query))
      : filtered;
    return [...searched].sort((a, b) => {
      if (sortMode === 'title') return a.metadata.title.localeCompare(b.metadata.title);
      if (sortMode === 'size') return b.size - a.size;
      if (sortMode === 'progress') return (a.ready ? 1 : 0) - (b.ready ? 1 : 0) || b.progress - a.progress;
      return b.id - a.id;
    });
  }, [library, debouncedQuery, activeFilter, activeGenre, sortMode]);

  const unmappedTorrents = useMemo(
    () => library.filter((t) => !t.metadata.tmdbId),
    [library],
  );

  const otherCount = library.filter((t) => !t.isMedia).length;
  const unmappedCount = unmappedTorrents.length;

  const allGenres = useMemo(() => {
    const set = new Set<string>();
    library.forEach((t) => { if (t.isMedia) (t.metadata.genres || []).forEach((g) => set.add(g)); });
    return Array.from(set).sort();
  }, [library]);

  // Continue watching from sv-progress keys
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
        const torrent = library.find((t) => t.id === torrentId);
        if (torrent && prog.d > 0) {
          items.push({ torrentId, fileId, torrent, progressSecs: prog.t, durationSecs: prog.d, savedAt: prog.at });
        }
      } catch {
        // ignore corrupt entries
      }
    }
    return items.sort((a, b) => b.savedAt - a.savedAt).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library, resumeVersion]);

  // --- Actions ---
  const playTorrent = useCallback((t: Torrent, fileId?: number | string, filename?: string, _subtitles?: SubtitleTrack[]) => {
    const params = new URLSearchParams();
    params.set('torrentId', String(t.id));
    params.set('fileId', String(fileId ?? t.videoFiles[0]?.id ?? ''));
    params.set('filename', filename ?? t.videoFiles[0]?.name ?? '');
    if (t.metadata.title) params.set('title', t.metadata.title);
    navigate(`/watch?${params.toString()}`);
  }, [navigate]);

  const playLibraryOnly = useCallback((meta: TorrentMetadata) => {
    if (!meta.tmdbId) return;
    const params = new URLSearchParams();
    if (meta.title) params.set('title', meta.title);
    if (meta.parsed?.season != null) params.set('season', String(meta.parsed.season));
    navigate(`/watch/${meta.type}/${meta.tmdbId}?${params.toString()}`);
  }, [navigate]);

  const openTorrent = useCallback((t: Torrent) => {
    const isLibraryOnly = t.videoFiles.length === 0 && !!t.metadata.tmdbId;
    if (isLibraryOnly) {
      playLibraryOnly(t.metadata);
      return;
    }
    setSelectedTorrent(t);
  }, [playLibraryOnly]);

  const handleResumePlay = useCallback((item: ResumeItem) => {
    const file = item.torrent.videoFiles.find((f) => f.id === item.fileId) ?? item.torrent.videoFiles[0];
    if (!file) return;
    playTorrent(item.torrent, file.id, file.name);
  }, [playTorrent]);

  const dismissContinueItem = useCallback((item: ResumeItem) => {
    localStorage.removeItem(`sv-progress:${item.torrentId}:${item.fileId}`);
    window.dispatchEvent(new CustomEvent('sv-progress'));
  }, []);

  const toggleWatchlist = useCallback((torrentId: number) => {
    setWatchlist((prev) => {
      const next = new Set(prev);
      const adding = !next.has(torrentId);
      if (adding) next.add(torrentId);
      else next.delete(torrentId);
      localStorage.setItem('sv-watchlist', JSON.stringify(Array.from(next)));
      showToast(adding ? 'Added to Watchlist' : 'Removed from Watchlist', 'info');
      return next;
    });
  }, [showToast]);

  const toggleSelected = useCallback((torrentId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(torrentId)) next.delete(torrentId);
      else next.add(torrentId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const openRemap = useCallback((t: Torrent) => {
    const hashes = t.sources && t.sources.length > 0 ? t.sources.map((s) => s.hash) : [t.hash];
    setRemapState({
      title: t.name,
      hashes,
      tmdbId: t.metadata.tmdbId ? String(t.metadata.tmdbId) : undefined,
      type: t.metadata.type === 'tv' ? 'tv' : 'movie',
      query: t.metadata.parsed?.title || t.metadata.title || t.name,
    });
  }, []);

  const openBatchRemap = useCallback(() => {
    const selected = library.filter((t) => selectedIds.has(t.id));
    if (selected.length === 0) return;
    const hashes: string[] = [];
    selected.forEach((t) => {
      if (t.sources && t.sources.length > 0) t.sources.forEach((s) => hashes.push(s.hash));
      else hashes.push(t.hash);
    });
    const first = selected[0];
    setRemapState({
      title: `${selected.length} selected torrents`,
      hashes,
      tmdbId: first.metadata.tmdbId ? String(first.metadata.tmdbId) : undefined,
      type: first.metadata.type === 'tv' ? 'tv' : 'movie',
      query: first.metadata.parsed?.title || first.metadata.title || first.name,
    });
    clearSelection();
  }, [library, selectedIds, clearSelection]);  const handleLibSearch = async () => {
    if (!libSearchQuery.trim()) return;
    setLibSearching(true);
    setLibSearchError('');
    try {
      const params = new URLSearchParams({ query: libSearchQuery.trim(), type: libSearchType });
      const response = await fetch(apiUrl(`/api/tmdb/search?${params}`), {
        headers: { Authorization: `Bearer ${token}` },
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

  const playSavedItem = useCallback((item: LibraryItem) => {
    const params = new URLSearchParams();
    params.set('title', item.title);
    if (item.season != null) params.set('season', String(item.season));
    navigate(`/watch/${item.type}/${item.tmdbId}?${params.toString()}`);
  }, [navigate]);

  const isLibraryOnly = (t: Torrent) => t.videoFiles.length === 0 && !!t.metadata.tmdbId;

  const renderCard = (t: Torrent) => {
    const meta = t.metadata;
    const poster = meta.posterPath;
    const title = meta.title || t.name;
    const year = meta.parsed?.year || (meta.releaseDate ? meta.releaseDate.slice(0, 4) : '');
    const selected = selectedIds.has(t.id);
    const watched = watchlist.has(t.id);
    return (
      <div
        key={t.id}
        className={`media-card glass-card lib-card${selected ? ' lib-card-selected' : ''}`}
        onClick={() => openTorrent(t)}
      >
        <div className="media-poster-wrap">
          <button
            className="lib-select"
            onClick={(e) => { e.stopPropagation(); toggleSelected(t.id); }}
            title={selected ? 'Deselect' : 'Select for batch actions'}
          >
            {selected ? <SquareCheck size={17} color="var(--accent-primary)" /> : <Square size={17} />}
          </button>
          <button
            className="lib-heart"
            onClick={(e) => { e.stopPropagation(); toggleWatchlist(t.id); }}
            title={watched ? 'Remove from Watchlist' : 'Add to Watchlist'}
          >
            <Heart size={15} fill={watched ? 'currentColor' : 'none'} />
          </button>
          {poster ? (
            <img className="poster media-poster" src={poster} alt={title} loading="lazy" />
          ) : (
            <div className="media-poster media-poster-fallback">
              {meta.type === 'tv' ? <Tv size={36} /> : <Film size={36} />}
            </div>
          )}
          <span className="lib-type-badge">{!t.isMedia ? 'Other' : meta.type === 'tv' ? 'TV' : 'Movie'}</span>
          {meta.rating ? <span className="rating-badge">{meta.rating.toFixed(1)}</span> : null}
          {!t.ready && (
            <div className="lib-progress">
              <div className="lib-progress-bar" style={{ width: `${Math.min(100, t.progress)}%` }} />
            </div>
          )}
          <div className="play-overlay">
            <div className="play-overlay-circle">
              <Play size={22} fill="currentColor" />
            </div>
          </div>
        </div>
        <div className="media-card-info">
          <p className="media-card-title" title={title}>{title}</p>
          <p className="media-card-year">
            {[year, meta.type === 'tv' ? 'TV' : 'Movie'].filter(Boolean).join(' · ')}
            {t.videoFiles.length > 0 ? ` · ${t.videoFiles.length} file${t.videoFiles.length === 1 ? '' : 's'}` : ''}
          </p>
          {t.badges && t.badges.length > 0 && <BadgeBar badges={t.badges} max={3} />}
        </div>
      </div>
    );
  };  const renderListRow = (t: Torrent) => {
    const meta = t.metadata;
    const libOnly = isLibraryOnly(t);
    const selected = selectedIds.has(t.id);
    const watched = watchlist.has(t.id);
    return (
      <div
        key={t.id}
        className={`sv-list-row${selected ? ' sv-list-row-selected' : ''}`}
        onClick={() => openTorrent(t)}
      >
        <button
          className="sv-list-check"
          onClick={(e) => { e.stopPropagation(); toggleSelected(t.id); }}
          title={selected ? 'Deselect' : 'Select'}
        >
          {selected ? <SquareCheck size={18} color="var(--accent-primary)" /> : <Square size={18} />}
        </button>
        {meta.posterPath ? (
          <img className="sv-list-poster" src={meta.posterPath} alt="" />
        ) : (
          <div className="sv-list-poster sv-list-poster-fallback">
            {meta.type === 'tv' ? <Tv size={18} /> : <Film size={18} />}
          </div>
        )}
        <div className="sv-list-main">
          <p className="sv-list-title">{meta.title || t.name}</p>
          <p className="sv-list-meta">
            {meta.parsed?.year || (meta.releaseDate ? meta.releaseDate.slice(0, 4) : 'No Year')}
            {' · '}{meta.type === 'tv' ? 'TV' : 'Movie'}
            {t.videoFiles.length > 0 ? ` · ${t.videoFiles.length} file(s)` : ''}
          </p>
        </div>
        <div className="sv-list-status">
          {libOnly ? (
            <><SlidersHorizontal size={14} color="var(--accent-primary)" /><span>Sources</span></>
          ) : t.ready ? (
            <><CheckCircle2 size={14} color="var(--success)" /><span>Ready</span></>
          ) : (
            <><ArrowDownCircle size={14} className="spinner" /><span>{Math.round(t.progress)}%</span></>
          )}
        </div>
        <div className="sv-list-actions" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => toggleWatchlist(t.id)}
            title={watched ? 'Remove from Watchlist' : 'Add to Watchlist'}
            className="lib-row-btn"
            style={{ color: watched ? 'var(--accent-primary)' : undefined }}
          >
            <Heart size={14} fill={watched ? 'currentColor' : 'none'} />
          </button>
          <button onClick={() => openRemap(t)} className="lib-row-btn" title="Remap / fix metadata">
            <Settings size={14} />
          </button>
        </div>
      </div>
    );
  };

  const filterChips: { id: FilterMode; label: string; count?: number }[] = [
    { id: 'all', label: 'All' },
    { id: 'movie', label: 'Movies' },
    { id: 'tv', label: 'TV Shows' },
    { id: 'downloading', label: 'Downloading' },
    { id: 'saved', label: 'Saved', count: localLibrary.length },
    { id: 'other', label: 'Other', count: otherCount },
    { id: 'unmapped', label: 'Not Mapped', count: unmappedCount },
  ];

  return (
    <div className="page-container lib-page">
      {/* Header */}
      <div className="lib-header">
        <div>
          <h1 className="page-title">Your Library</h1>
          <p className="page-subtitle">
            {library.length} torrent{library.length === 1 ? '' : 's'} in your TorBox account
            {unmappedCount > 0 ? ` · ${unmappedCount} unmapped` : ''}
          </p>
        </div>
        <div className="lib-header-actions">
          <button className="glass-button" onClick={() => fetchLibrary(true)} disabled={loading || refreshing} title="Refresh">
            {refreshing ? <Loader2 size={16} className="spinner" /> : <RefreshCw size={16} />}
            Refresh
          </button>
          <button className="glass-button glass-button-primary" onClick={() => setShowDownloadManager(true)} title="Add a torrent to TorBox">
            <PlusCircle size={16} />
            Add Torrent
          </button>
          <button className="glass-button" onClick={() => setShowSettings(true)} title="Settings">
            <Settings size={16} />
            Settings
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="glass-panel lib-toolbar">
        <div className="lib-chips">
          {filterChips.map((chip) => (
            <button
              key={chip.id}
              className={`lib-chip${activeFilter === chip.id ? ' active' : ''}`}
              onClick={() => setActiveFilter(chip.id)}
            >
              {chip.label}
              {chip.count !== undefined ? <span className="lib-chip-count">{chip.count}</span> : null}
            </button>
          ))}
        </div>
        <div className="lib-toolbar-row">
          <div className="lib-search">
            <Search size={15} />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search your library…"
              className="glass-input"
            />
          </div>
          <select value={activeGenre ?? ''} onChange={(e) => setActiveGenre(e.target.value || null)} className="glass-input lib-genre-select">
            <option value="">All genres</option>
            {allGenres.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)} className="glass-input lib-sort-select">
            <option value="added">Recently added</option>
            <option value="title">Title</option>
            <option value="size">Size</option>
            <option value="progress">Progress</option>
          </select>
          <div className="lib-view-toggle">
            <button
              className={viewMode === 'grid' ? 'active' : ''}
              onClick={() => setViewMode('grid')}
              title="Grid view"
            >
              <LayoutGrid size={16} />
            </button>
            <button
              className={viewMode === 'list' ? 'active' : ''}
              onClick={() => setViewMode('list')}
              title="List view"
            >
              <ListIcon size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Continue watching */}
      {activeFilter === 'all' && continueWatching.length > 0 && (
        <section className="lib-section">
          <h2 className="section-title">Continue Watching</h2>
          <div className="media-row">
            {continueWatching.map((item) => {
              const meta = item.torrent.metadata;
              const pct = item.durationSecs > 0 ? Math.min(100, (item.progressSecs / item.durationSecs) * 100) : 0;
              return (
                <div key={`${item.torrentId}-${item.fileId}`} className="media-card glass-card lib-resume-card">
                  <div className="media-poster-wrap" onClick={() => handleResumePlay(item)}>
                    {meta.posterPath ? (
                      <img className="poster media-poster" src={meta.posterPath} alt={meta.title} loading="lazy" />
                    ) : (
                      <div className="media-poster media-poster-fallback"><Film size={36} /></div>
                    )}
                    <div className="play-overlay">
                      <div className="play-overlay-circle"><Play size={22} fill="currentColor" /></div>
                    </div>
                    <div className="lib-resume-progress">
                      <div className="lib-progress-bar" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="media-card-info">
                    <p className="media-card-title">{meta.title}</p>
                    <p className="media-card-year">{formatTime(item.progressSecs)} / {formatTime(item.durationSecs)}</p>
                  </div>
                  <button className="lib-dismiss" onClick={() => dismissContinueItem(item)} title="Dismiss"><X size={12} /></button>
                </div>
              );
            })}
          </div>
        </section>
      )}      {/* Saved tab (IndexedDB library) */}
      {activeFilter === 'saved' && (
        <section className="lib-section">
          <div className="lib-saved-search">
            <select
              value={libSearchType}
              onChange={(e) => { setLibSearchType(e.target.value as 'movie' | 'tv'); setLibSearchResults([]); setLibSearchError(''); }}
              className="glass-input"
              style={{ width: 110, flexShrink: 0 }}
            >
              <option value="movie">Movie</option>
              <option value="tv">TV Show</option>
            </select>
            <input
              value={libSearchQuery}
              onChange={(e) => setLibSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleLibSearch(); }}
              placeholder="Search TMDb to save a title…"
              className="glass-input"
              style={{ flexGrow: 1 }}
            />
            <button className="glass-button glass-button-primary" onClick={handleLibSearch} disabled={libSearching || !libSearchQuery.trim()}>
              {libSearching ? <Loader2 size={16} className="spinner" /> : <Search size={16} />}
            </button>
          </div>
          {libSearchError && <p style={{ color: 'var(--error)', fontSize: 13 }}>{libSearchError}</p>}
          {libSearchResults.length > 0 && (
            <div className="lib-saved-results">
              {libSearchResults.map((result) => {
                const title = result.title || result.name || 'Untitled';
                const date = result.release_date || result.first_air_date;
                const inLib = libInDB.has(result.id);
                return (
                  <div key={result.id} className="lib-saved-result">
                    {result.poster_path ? (
                      <img src={`https://image.tmdb.org/t/p/w92${result.poster_path}`} alt="" />
                    ) : (
                      <div className="lib-remap-fallback"><Film size={16} /></div>
                    )}
                    <div style={{ flexGrow: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {title} {date ? `(${date.slice(0, 4)})` : ''}
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {result.overview ? result.overview.slice(0, 90) + '…' : 'No description.'}
                      </p>
                    </div>
                    <button
                      className="glass-button"
                      onClick={() => inLib ? handleRemoveFromLibrary(result.id, title) : handleAddToLibrary(result, libSearchType)}
                      title={inLib ? 'Remove from library' : 'Add to library'}
                    >
                      {inLib ? <BookmarkCheck size={16} color="var(--accent-primary)" /> : <BookmarkPlus size={16} />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <h2 className="section-title" style={{ marginTop: 24 }}>Saved Titles</h2>
          {localLibrary.length === 0 ? (
            <div className="glass-panel lib-empty">
              <BookmarkPlus size={36} color="var(--text-muted)" />
              <h3>No saved titles</h3>
              <p className="page-subtitle">Search above to save movies and shows. They play through streaming sources.</p>
            </div>
          ) : (
            <div className="media-grid">
              {localLibrary.map((item) => (
                <div key={item.tmdbId} className="media-card glass-card lib-card" onClick={() => playSavedItem(item)}>
                  <div className="media-poster-wrap">
                    {item.posterPath ? (
                      <img className="poster media-poster" src={item.posterPath} alt={item.title} loading="lazy" />
                    ) : (
                      <div className="media-poster media-poster-fallback">
                        {item.type === 'tv' ? <Tv size={36} /> : <Film size={36} />}
                      </div>
                    )}
                    <span className="lib-type-badge">{item.type === 'tv' ? 'TV' : 'Movie'}</span>
                    <div className="play-overlay">
                      <div className="play-overlay-circle"><Play size={22} fill="currentColor" /></div>
                    </div>
                  </div>
                  <div className="media-card-info">
                    <p className="media-card-title">{item.title}</p>
                    <p className="media-card-year">
                      {item.type === 'tv' && item.season != null ? `S${item.season}E${item.episode ?? 1}` : 'Saved'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Batch bar */}
      {activeFilter !== 'saved' && selectedIds.size > 0 && (
        <div className="glass-panel lib-batch-bar">
          <span style={{ fontSize: 13, fontWeight: 600 }}>{selectedIds.size} selected</span>
          <button className="glass-button" onClick={openBatchRemap} style={{ padding: '8px 14px', fontSize: 13 }}>
            <Settings size={14} /> Remap selected
          </button>
          <button className="glass-button" onClick={clearSelection} style={{ padding: '8px 14px', fontSize: 13 }}>
            <X size={14} /> Clear
          </button>
        </div>
      )}

      {/* Main grid / list */}
      {activeFilter !== 'saved' && (
        loading ? (
          <div className="lib-status">
            <Loader2 size={40} className="spinner" />
            <p className="page-subtitle">Loading your library…</p>
          </div>
        ) : error ? (
          <div className="lib-status">
            <div className="glass-panel lib-empty">
              <AlertCircle size={36} color="var(--error)" />
              <h3>Error Loading Library</h3>
              <p className="page-subtitle">{error}</p>
              <button className="glass-button glass-button-primary" onClick={() => fetchLibrary()} style={{ marginTop: 16 }}>
                Retry Connection
              </button>
            </div>
          </div>
        ) : viewMode === 'list' ? (
          <div className="sv-list lib-list">
            {filteredLibrary.map(renderListRow)}
            {filteredLibrary.length === 0 && (
              <div className="glass-panel lib-empty">
                <SlidersHorizontal size={36} color="var(--text-muted)" />
                <h3>No media found</h3>
                <p className="page-subtitle">
                  {debouncedQuery ? 'Try adjusting your search query' : 'Your TorBox account has no mapped video torrents yet.'}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="media-grid">
            {filteredLibrary.map(renderCard)}
            {filteredLibrary.length === 0 && (
              <div className="glass-panel lib-empty" style={{ gridColumn: '1 / -1' }}>
                <SlidersHorizontal size={36} color="var(--text-muted)" />
                <h3>No media found</h3>
                <p className="page-subtitle">
                  {debouncedQuery ? 'Try adjusting your search query' : 'Your TorBox account has no mapped video torrents yet.'}
                </p>
              </div>
            )}
          </div>
        )
      )}

      {/* Unmapped section */}
      {activeFilter === 'all' && unmappedTorrents.length > 0 && (
        <section className="lib-section">
          <div className="lib-section-header">
            <h2 className="section-title">Not Mapped ({unmappedTorrents.length})</h2>
            <button className="glass-button" onClick={() => setActiveFilter('unmapped')} style={{ padding: '6px 12px', fontSize: 12 }}>
              View all
            </button>
          </div>
          <div className="media-grid">
            {unmappedTorrents.slice(0, 8).map((t) => (
              <div key={t.id} className="media-card glass-card lib-card" onClick={() => openRemap(t)}>
                <div className="media-poster-wrap">
                  <div className="media-poster media-poster-fallback"><Film size={36} /></div>
                  <span className="lib-type-badge">Unmapped</span>
                  {!t.ready && (
                    <div className="lib-progress">
                      <div className="lib-progress-bar" style={{ width: `${Math.min(100, t.progress)}%` }} />
                    </div>
                  )}
                  <div className="play-overlay">
                    <div className="play-overlay-circle"><Settings size={20} /></div>
                  </div>
                </div>
                <div className="media-card-info">
                  <p className="media-card-title">{t.name}</p>
                  <p className="media-card-year">{formatBytes(t.size)} · Remap</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Modals */}
      {selectedTorrent && (
        <DetailModal
          torrent={selectedTorrent}
          sources={selectedTorrent.sources}
          onClose={() => setSelectedTorrent(null)}
          onPlay={(torrentId, fileId, filename, _subtitles, _videoFiles, metadataOverride) => {
            setSelectedTorrent(null);
            if (torrentId != null && fileId != null) {
              const params = new URLSearchParams();
              params.set('torrentId', String(torrentId));
              params.set('fileId', String(fileId));
              if (filename) params.set('filename', filename);
              if (metadataOverride?.title) params.set('title', metadataOverride.title);
              navigate(`/watch?${params.toString()}`);
            } else if (metadataOverride) {
              playLibraryOnly(metadataOverride);
            }
          }}
        />
      )}

      {remapState && (
        <RemapModal
          title={remapState.title}
          hashes={remapState.hashes}
          initialTmdbId={remapState.tmdbId}
          initialType={remapState.type}
          initialQuery={remapState.query}
          onClose={() => setRemapState(null)}
          onDone={() => {
            setRemapState(null);
            showToast('Metadata updated!');
            fetchLibrary(true);
          }}
        />
      )}

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showDownloadManager && (
        <DownloadManagerModal
          token={token!}
          onClose={() => setShowDownloadManager(false)}
          onSuccess={(message) => showToast(message)}
          onLibraryRefresh={() => fetchLibrary(true)}
        />
      )}

      {toast && (
        <div className={`lib-toast lib-toast-${toast.type}`}>
          {toast.type === 'error' ? <AlertCircle size={15} /> : toast.type === 'info' ? <X size={15} /> : <CheckCircle2 size={15} />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
};

export default Library;