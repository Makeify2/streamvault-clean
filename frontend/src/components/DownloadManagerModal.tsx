import React, { useState, useEffect } from 'react';
import { Search, X, Film, Tv, Loader2, CheckCircle2, Link2, Plus } from 'lucide-react';
import { apiUrl } from '../lib/api';
import { formatBytes } from '../lib/utils';

interface TmdbResult {
  id: number;
  title?: string;
  name?: string;
  overview: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
}

interface TorBoxResult {
  hash: string;
  name: string;
  size: number;
  seeds: number;
  peers: number;
  owned?: boolean;
}

interface Props {
  token: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onLibraryRefresh: () => void;
}

type Tab = 'search' | 'magnet';

export const DownloadManagerModal: React.FC<Props> = ({ token, onClose, onSuccess, onLibraryRefresh }) => {
  const [tab, setTab] = useState<Tab>('search');

  const [tmdbQuery, setTmdbQuery] = useState('');
  const [tmdbType, setTmdbType] = useState<'movie' | 'tv'>('movie');
  const [tmdbResults, setTmdbResults] = useState<TmdbResult[]>([]);
  const [tmdbSearching, setTmdbSearching] = useState(false);
  const [selectedTmdb, setSelectedTmdb] = useState<TmdbResult | null>(null);

  const [torboxResults, setTorboxResults] = useState<TorBoxResult[]>([]);
  const [torboxSearching, setTorboxSearching] = useState(false);
  const [selectedTorbox, setSelectedTorbox] = useState<TorBoxResult | null>(null);

  const [magnet, setMagnet] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const searchTmdb = async () => {
    if (!tmdbQuery.trim()) return;
    setTmdbSearching(true);
    setError('');
    setTmdbResults([]);
    setSelectedTmdb(null);
    setTorboxResults([]);
    setSelectedTorbox(null);
    try {
      const params = new URLSearchParams({ query: tmdbQuery.trim(), type: tmdbType });
      const r = await fetch(apiUrl(`/api/tmdb/search?${params}`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await r.json();
      if (r.ok && data.success) {
        setTmdbResults((data.data || []).slice(0, 8));
        if ((data.data || []).length === 0) setError('No TMDb results. Try a different title.');
      } else {
        setError(data.detail || 'TMDb search failed.');
      }
    } catch {
      setError('Network error during TMDb search.');
    } finally {
      setTmdbSearching(false);
    }
  };

  const searchTorBox = async (title: string) => {
    setTorboxSearching(true);
    setError('');
    setTorboxResults([]);
    setSelectedTorbox(null);
    try {
      const r = await fetch(apiUrl(`/api/torbox/search?query=${encodeURIComponent(title)}`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await r.json();
      if (r.ok && data.success) {
        setTorboxResults(data.data || []);
        if ((data.data || []).length === 0) setError('No results on TorBox for that title.');
      } else {
        setError(data.detail || 'TorBox search failed.');
      }
    } catch {
      setError('Network error during TorBox search.');
    } finally {
      setTorboxSearching(false);
    }
  };

  const handleSelectTmdb = (result: TmdbResult) => {
    setSelectedTmdb(result);
    const title = result.title || result.name || '';
    const year = (result.release_date || result.first_air_date || '').slice(0, 4);
    searchTorBox(year ? `${title} ${year}` : title);
  };

  const addTorrent = async (magnetLink: string) => {
    setAdding(true);
    setError('');
    try {
      const r = await fetch(apiUrl('/api/torbox/add'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ magnet: magnetLink })
      });
      const data = await r.json();
      if (r.ok && data.success) {
        onSuccess('Torrent added to TorBox!');
        onLibraryRefresh();
        onClose();
      } else {
        setError(data.detail || 'Failed to add torrent.');
      }
    } catch {
      setError('Network error. Could not add torrent.');
    } finally {
      setAdding(false);
    }
  };

  const handleAddSelected = () => {
    if (!selectedTorbox) return;
    const magnetLink = `magnet:?xt=urn:btih:${selectedTorbox.hash}&dn=${encodeURIComponent(selectedTorbox.name)}`;
    addTorrent(magnetLink);
  };

  const handleAddMagnet = () => {
    const trimmed = magnet.trim();
    if (!trimmed.startsWith('magnet:')) return;
    addTorrent(trimmed);
  };

  return (
    <div style={styles.backdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div className="glass-panel" style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={{ fontSize: '18px', fontWeight: 700 }}>Add to Library</h3>
          <button onClick={onClose} style={styles.closeBtn}><X size={18} /></button>
        </div>

        <div style={styles.tabs}>
          <button
            style={tab === 'search' ? styles.tabActive : styles.tab}
            onClick={() => { setTab('search'); setError(''); }}
          >
            <Search size={14} /> Search TMDb
          </button>
          <button
            style={tab === 'magnet' ? styles.tabActive : styles.tab}
            onClick={() => { setTab('magnet'); setError(''); }}
          >
            <Link2 size={14} /> Magnet Link
          </button>
        </div>

        {tab === 'search' && (
          <div style={styles.body}>
            <div style={styles.radioRow}>
              {(['movie', 'tv'] as const).map(t => (
                <label key={t} style={styles.radioLabel}>
                  <input
                    type="radio"
                    name="dmType"
                    checked={tmdbType === t}
                    onChange={() => setTmdbType(t)}
                  />
                  <span>{t === 'movie' ? 'Movie' : 'TV Show'}</span>
                </label>
              ))}
            </div>

            <div style={styles.searchRow}>
              <input
                type="text"
                value={tmdbQuery}
                onChange={e => setTmdbQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchTmdb(); } }}
                placeholder="Search title on TMDb..."
                className="glass-input"
                style={{ flexGrow: 1 }}
                autoFocus
              />
              <button
                onClick={searchTmdb}
                className="glass-button"
                style={{ padding: '10px 16px' }}
                disabled={tmdbSearching || !tmdbQuery.trim()}
              >
                {tmdbSearching ? <Loader2 size={16} className="spinner" /> : <Search size={16} />}
              </button>
            </div>

            {tmdbResults.length > 0 && (
              <>
                <p style={styles.sectionLabel}>Pick a title</p>
                <div style={styles.resultList}>
                  {tmdbResults.map(result => {
                    const title = result.title || result.name || 'Untitled';
                    const date = result.release_date || result.first_air_date;
                    const isSelected = selectedTmdb?.id === result.id;
                    return (
                      <button
                        key={result.id}
                        onClick={() => handleSelectTmdb(result)}
                        style={isSelected ? styles.resultItemActive : styles.resultItem}
                      >
                        {result.poster_path ? (
                          <img
                            src={`https://image.tmdb.org/t/p/w92${result.poster_path}`}
                            alt={title}
                            style={styles.resultPoster}
                          />
                        ) : (
                          <div style={styles.resultNoPoster}>
                            {tmdbType === 'tv' ? <Tv size={14} /> : <Film size={14} />}
                          </div>
                        )}
                        <div style={styles.resultInfo}>
                          <span style={styles.resultTitle}>{title}{date ? ` (${date.slice(0, 4)})` : ''}</span>
                          <span style={styles.resultMeta}>★ {result.vote_average.toFixed(1)}</span>
                        </div>
                        {isSelected && <CheckCircle2 size={16} color="var(--accent-primary)" style={{ flexShrink: 0 }} />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {(torboxSearching || torboxResults.length > 0) && (
              <>
                <p style={styles.sectionLabel}>
                  TorBox results
                  {torboxSearching && <Loader2 size={12} className="spinner" style={{ marginLeft: '8px' }} />}
                </p>
                {!torboxSearching && (
                  <div style={styles.resultList}>
                    {torboxResults.map(result => {
                      const isSelected = selectedTorbox?.hash === result.hash;
                      return (
                        <button
                          key={result.hash}
                          onClick={() => setSelectedTorbox(result)}
                          style={isSelected ? styles.torboxItemActive : styles.torboxItem}
                        >
                          <div style={styles.torboxInfo}>
                            <span style={styles.torboxName}>{result.name}</span>
                            <span style={styles.torboxMeta}>
                              {formatBytes(result.size)} · {result.seeds} seeds
                              {result.owned && <span style={styles.ownedChip}>In TorBox</span>}
                            </span>
                          </div>
                          {isSelected && <CheckCircle2 size={16} color="var(--accent-primary)" style={{ flexShrink: 0 }} />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {error && <p style={styles.errorMsg}>{error}</p>}

            <div style={styles.footer}>
              <button onClick={onClose} className="glass-button" disabled={adding}>Cancel</button>
              <button
                onClick={handleAddSelected}
                className="glass-button glass-button-primary"
                disabled={!selectedTorbox || adding}
              >
                {adding ? <Loader2 size={16} className="spinner" /> : <Plus size={16} />}
                <span>{adding ? 'Adding...' : 'Add to TorBox'}</span>
              </button>
            </div>
          </div>
        )}

        {tab === 'magnet' && (
          <div style={styles.body}>
            <p style={styles.sectionLabel}>Paste a magnet link</p>
            <textarea
              value={magnet}
              onChange={e => setMagnet(e.target.value)}
              placeholder="magnet:?xt=urn:btih:..."
              className="glass-input"
              style={styles.magnetInput}
              rows={4}
              autoFocus
            />
            {error && <p style={styles.errorMsg}>{error}</p>}
            <div style={styles.footer}>
              <button onClick={onClose} className="glass-button" disabled={adding}>Cancel</button>
              <button
                onClick={handleAddMagnet}
                className="glass-button glass-button-primary"
                disabled={!magnet.trim().startsWith('magnet:') || adding}
              >
                {adding ? <Loader2 size={16} className="spinner" /> : <Plus size={16} />}
                <span>{adding ? 'Adding...' : 'Add to TorBox'}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    top: 0, left: 0,
    width: '100vw', height: '100vh',
    background: 'rgba(0,0,0,0.7)',
    backdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
    padding: '24px',
  },
  modal: {
    width: '100%',
    maxWidth: '560px',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '24px 28px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  closeBtn: {
    background: 'none', border: 'none',
    color: 'var(--text-muted)', cursor: 'pointer', outline: 'none',
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    padding: '12px 28px 0',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  tab: {
    background: 'none',
    border: '1px solid transparent',
    borderBottom: 'none',
    color: 'var(--text-muted)',
    padding: '8px 16px',
    borderRadius: '8px 8px 0 0',
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  tabActive: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderBottom: '1px solid rgba(18,18,28,1)',
    color: 'var(--text-primary)',
    padding: '8px 16px',
    borderRadius: '8px 8px 0 0',
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontWeight: 600,
    marginBottom: '-1px',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    padding: '20px 28px',
    overflowY: 'auto',
    flexGrow: 1,
  },
  radioRow: {
    display: 'flex',
    gap: '20px',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    cursor: 'pointer',
    color: 'var(--text-secondary)',
  },
  searchRow: {
    display: 'flex',
    gap: '8px',
  },
  sectionLabel: {
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    display: 'flex',
    alignItems: 'center',
    margin: 0,
  },
  resultList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    maxHeight: '210px',
    overflowY: 'auto' as const,
    paddingRight: '2px',
  },
  resultItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'left' as const,
    color: 'var(--text-primary)',
    transition: 'var(--transition-smooth)',
  },
  resultItemActive: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px',
    background: 'rgba(0,242,254,0.06)',
    border: '1px solid rgba(0,242,254,0.3)',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'left' as const,
    color: 'var(--text-primary)',
    transition: 'var(--transition-smooth)',
  },
  resultPoster: {
    width: '40px',
    height: '60px',
    objectFit: 'cover' as const,
    borderRadius: '4px',
    flexShrink: 0,
  },
  resultNoPoster: {
    width: '40px',
    height: '60px',
    background: 'rgba(255,255,255,0.05)',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  resultInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flexGrow: 1,
    minWidth: 0,
  },
  resultTitle: {
    fontSize: '13px',
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  resultMeta: {
    fontSize: '11px',
    color: 'var(--text-muted)',
  },
  torboxItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'left' as const,
    color: 'var(--text-primary)',
    transition: 'var(--transition-smooth)',
  },
  torboxItemActive: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    background: 'rgba(0,242,254,0.06)',
    border: '1px solid rgba(0,242,254,0.3)',
    borderRadius: '8px',
    cursor: 'pointer',
    textAlign: 'left' as const,
    color: 'var(--text-primary)',
    transition: 'var(--transition-smooth)',
  },
  torboxInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flexGrow: 1,
    minWidth: 0,
  },
  torboxName: {
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: 1.4,
    color: 'var(--text-primary)',
    wordBreak: 'break-word' as const,
  },
  torboxMeta: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  ownedChip: {
    fontSize: '10px',
    fontWeight: 700,
    color: 'var(--success)',
    background: 'rgba(34,197,94,0.1)',
    border: '1px solid rgba(34,197,94,0.25)',
    padding: '1px 6px',
    borderRadius: '4px',
  },
  magnetInput: {
    width: '100%',
    fontFamily: 'monospace',
    fontSize: '12px',
    resize: 'vertical' as const,
    minHeight: '90px',
  },
  errorMsg: {
    color: 'var(--error)',
    fontSize: '13px',
    fontWeight: 500,
    margin: 0,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    paddingTop: '16px',
    borderTop: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
    marginTop: 'auto',
  },
};
