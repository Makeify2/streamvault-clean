import React, { useState, useEffect, useMemo } from 'react';
import { Play, X, Star, Calendar, Film, Info, AlertTriangle, ExternalLink } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { BadgeBar } from './BadgeBar';
import type { SubtitleTrack, VideoFile, TorrentSource, Torrent, TorrentMetadata } from '../types';
import { apiUrl } from '../lib/api';
import { parseEpisodeFromFile, formatBytes } from '../lib/utils';

interface DetailModalProps {
  torrent: Torrent;
  sources?: TorrentSource[];
  onClose: () => void;
  onPlay: (torrentId: number | undefined, fileId: number | undefined, filename: string, subtitles: SubtitleTrack[], videoFiles?: VideoFile[], metadataOverride?: TorrentMetadata) => void;
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

interface CastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
}

export const DetailModal: React.FC<DetailModalProps> = ({ torrent, sources, onClose, onPlay }) => {
  const { token } = useAuth();

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const hasMultipleSources = !!(sources && sources.length > 1);
  const [sourceIndex, setSourceIndex] = useState(0);

  // Derive the currently-active torrent fields based on selected source
  const activeSource = useMemo(() => {
    if (!hasMultipleSources) return torrent;
    const src = sources![sourceIndex];
    return {
      ...torrent,
      id: src.torrentId,
      name: src.name,
      hash: src.hash,
      size: src.size,
      progress: src.progress,
      status: src.status,
      download_finished: src.download_finished,
      ready: src.ready,
      videoFiles: src.videoFiles,
      badges: src.badges,
    };
  }, [torrent, hasMultipleSources, sources, sourceIndex]);

  const currentTorrent = activeSource;

  const [selectedSeason, setSelectedSeason] = useState<number>(torrent.metadata.parsed.season || 1);
  const [episodes, setEpisodes] = useState<TVEpisode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodesError, setEpisodesError] = useState('');

  const [cast, setCast] = useState<CastMember[]>([]);
  const [trailerLoading, setTrailerLoading] = useState(false);

  const isTV = torrent.metadata.type === 'tv';
  const meta = torrent.metadata;

  // Derive seasons list from torrent data (pure computation)
  const seasonsList = useMemo(() => {
    if (!isTV) return [] as number[];
    const parsedSeason = torrent.metadata.parsed.season || 1;

    const filesSeasons = new Set<number>();
    currentTorrent.videoFiles.forEach(file => {
      const parsed = parseEpisodeFromFile(file.name);
      if (parsed && parsed.season > 0) {
        filesSeasons.add(parsed.season);
      }
    });

    const seasons = filesSeasons.size > 0 ? Array.from(filesSeasons) : [parsedSeason];
    const maxSeason = Math.max(...seasons, 1);
    const list: number[] = [];
    for (let i = 1; i <= maxSeason; i++) {
      list.push(i);
    }
    return list;
  }, [isTV, torrent, currentTorrent]);

  // Reset selected season when torrent changes
  useEffect(() => {
    const parsedSeason = torrent.metadata.parsed.season || 1;
    const filesSeasons = new Set<number>();
    currentTorrent.videoFiles.forEach(file => {
      const parsed = parseEpisodeFromFile(file.name);
      if (parsed && parsed.season > 0) {
        filesSeasons.add(parsed.season);
      }
    });
    if (filesSeasons.size > 0) {
      const sorted = Array.from(filesSeasons).sort((a, b) => a - b);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedSeason(sorted[0]);
    } else {
      setSelectedSeason(parsedSeason);
    }
  }, [torrent.id, currentTorrent.id]);

  // Fetch cast on mount
  useEffect(() => {
    if (!meta.tmdbId) return;
    const type = isTV ? 'tv' : 'movie';
    fetch(apiUrl(`/api/tmdb/credits/${type}/${meta.tmdbId}`), {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data?.cast) setCast(d.data.cast.slice(0, 10));
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.tmdbId, isTV]);

  const handleTrailer = async () => {
    if (!meta.tmdbId || trailerLoading) return;
    setTrailerLoading(true);
    try {
      const type = isTV ? 'tv' : 'movie';
      const r = await fetch(apiUrl(`/api/tmdb/trailer/${type}/${meta.tmdbId}`), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const d = await r.json();
      if (d.success && d.data?.key) {
        window.open(`https://www.youtube.com/watch?v=${d.data.key}`, '_blank', 'noopener,noreferrer');
      }
    } catch {}
    setTrailerLoading(false);
  };

  // Fetch episodes when season changes
  useEffect(() => {
    const fetchEpisodes = async () => {
      if (!isTV || !meta.tmdbId) return;
      
      setEpisodesLoading(true);
      setEpisodesError('');
      try {
        const response = await fetch(apiUrl(`/api/tmdb/tv/${meta.tmdbId}/season/${selectedSeason}`), {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const data = await response.json();
        
        if (response.ok && data.success && data.data) {
          setEpisodes(data.data.episodes || []);
        } else {
          setEpisodesError(data.detail || 'Failed to fetch episodes list.');
        }
      } catch (err) {
        console.error(err);
        setEpisodesError('Failed to fetch episodes due to network error.');
      } finally {
        setEpisodesLoading(false);
      }
    };

    fetchEpisodes();
  }, [selectedSeason, isTV, meta.tmdbId, token]);

  // Find a matching file in the selected source for a given episode
  const findFileForEpisode = (episodeNum: number): VideoFile | null => {
    if (currentTorrent.videoFiles.length === 0) return null;

    // 1. Match by exact season and episode parsed from filename
    for (const file of currentTorrent.videoFiles) {
      const parsed = parseEpisodeFromFile(file.name);
      if (parsed) {
        const seasonMatches = parsed.season === selectedSeason || parsed.season === -1;
        const episodeMatches = parsed.episode === episodeNum;
        if (seasonMatches && episodeMatches) {
          return file;
        }
      }
    }

    // 2. If it is a single-episode torrent and matches this episode number
    if (currentTorrent.metadata.parsed.episode === episodeNum &&
        (currentTorrent.metadata.parsed.season === selectedSeason || !currentTorrent.metadata.parsed.season)) {
      return getLargestVideoFile();
    }

    // 3. Fallback: If there's only 1 video file in the source and this is the only episode we have
    if (currentTorrent.videoFiles.length === 1 && currentTorrent.metadata.parsed.episode === episodeNum) {
      return currentTorrent.videoFiles[0];
    }

    return null;
  };

  const getLargestVideoFile = (): VideoFile | null => {
    if (currentTorrent.videoFiles.length === 0) return null;
    return [...currentTorrent.videoFiles].sort((a, b) => b.size - a.size)[0];
  };

  const mainMovieFile = !isTV ? getLargestVideoFile() : null;

  return (
    <div style={styles.backdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="glass-panel sv-modal-container"
        style={{
          ...styles.container,
          backgroundImage: meta.backdropPath ? `linear-gradient(to bottom, rgba(7, 7, 10, 0.8) 0%, #07070a 100%), url(${meta.backdropPath})` : 'none'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button onClick={onClose} style={styles.closeButton} aria-label="Close">
          <X size={20} />
        </button>

        {/* Modal Content */}
        <div style={styles.layout} className="sv-modal-layout">
          {/* Poster Section (Left Column) */}
          <div style={styles.sidebar} className="sv-modal-sidebar">
            {meta.posterPath ? (
              <img src={meta.posterPath} alt={meta.title} style={styles.poster} />
            ) : (
              <div style={styles.noPoster}>
                <Film size={48} color="var(--text-muted)" />
                <span>No Poster</span>
              </div>
            )}
            
            {/* Source selector for duplicate torrents */}
            {hasMultipleSources && (
              <div style={styles.sourceSelector}>
                <label style={styles.sourceLabel}>Source</label>
                <select
                  value={sourceIndex}
                  onChange={(e) => setSourceIndex(parseInt(e.target.value, 10))}
                  className="glass-input"
                  style={styles.sourceSelect}
                >
                  {sources!.map((s, i) => {
                    const badgeStr = s.badges && s.badges.length > 0
                      ? ' | ' + s.badges.map(b => b.name).join(' ')
                      : '';
                    return (
                      <option key={i} value={i} style={{ background: '#12121c', color: '#fff' }}>
                        {s.ready ? 'Ready' : `${Math.round(s.progress)}%`} — {formatBytes(s.size)} {s.name.length > 28 ? s.name.slice(0, 28) + '…' : s.name.slice(0, 32)}{badgeStr}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            {currentTorrent.badges && currentTorrent.badges.length > 0 && (
              <div style={{ marginBottom: '12px' }}>
                <BadgeBar badges={currentTorrent.badges} max={6} />
              </div>
            )}

            <div style={styles.torrentMeta}>
              <div style={styles.metaRow}>
                <span style={styles.metaLabel}>Size</span>
                <span style={styles.metaVal}>{formatBytes(currentTorrent.size)}</span>
              </div>
              <div style={styles.metaRow}>
                <span style={styles.metaLabel}>Status</span>
                <span style={{
                  ...styles.metaVal,
                  color: currentTorrent.ready ? 'var(--success)' : 'var(--warning)'
                }}>
                  {currentTorrent.ready ? 'Ready to stream' : `${currentTorrent.status} (${Math.round(currentTorrent.progress)}%)`}
                </span>
              </div>
              <div style={styles.metaRow}>
                <span style={styles.metaLabel}>Files</span>
                <span style={styles.metaVal}>{currentTorrent.videoFiles.length} video(s)</span>
              </div>
            </div>
          </div>

          {/* Details Section (Right Column) */}
          <div style={styles.mainContent}>
            <div style={styles.header}>
              <span style={styles.badge}>{isTV ? 'TV Series' : 'Movie'}</span>
              <h2 style={styles.title}>{meta.title}</h2>
              
              <div style={styles.subHeader}>
                {meta.rating && (
                  <div style={styles.rating}>
                    <Star size={16} fill="currentColor" color="var(--warning)" />
                    <span>{meta.rating.toFixed(1)}</span>
                  </div>
                )}

                {meta.releaseDate && (
                  <div style={styles.year}>
                    <Calendar size={16} />
                    <span>{new Date(meta.releaseDate).getFullYear()}</span>
                  </div>
                )}

                {meta.tmdbId && (
                  <button
                    onClick={handleTrailer}
                    className="glass-button"
                    style={styles.trailerBtn}
                    disabled={trailerLoading}
                    title="Watch trailer on YouTube"
                  >
                    <ExternalLink size={14} />
                    <span>{trailerLoading ? '…' : 'Trailer'}</span>
                  </button>
                )}
              </div>
            </div>

            {meta.genres && meta.genres.length > 0 && (
              <div style={styles.genresRow}>
                {meta.genres.map((g, idx) => (
                  <span key={idx} style={styles.genreBadge}>{g}</span>
                ))}
              </div>
            )}

            <div style={styles.overviewSection}>
              <h4 style={styles.sectionTitle}>Overview</h4>
              <p style={styles.overview}>
                {meta.overview || "No description available for this title."}
              </p>
            </div>

            {cast.length > 0 && (
              <div style={styles.castSection}>
                <h4 style={styles.sectionTitle}>Cast</h4>
                <div style={styles.castRow}>
                  {cast.map(member => (
                    <div key={member.id} style={styles.castCard}>
                      {member.profile_path ? (
                        <img
                          src={`https://image.tmdb.org/t/p/w185${member.profile_path}`}
                          alt={member.name}
                          style={styles.castPhoto}
                        />
                      ) : (
                        <div style={styles.castNoPhoto}>
                          <Film size={18} color="var(--text-muted)" />
                        </div>
                      )}
                      <p style={styles.castName}>{member.name}</p>
                      <p style={styles.castChar}>{member.character}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Movie Files List */}
            {!isTV && (
              <div style={styles.filesSection}>
                <h4 style={styles.sectionTitle}>Video Files ({currentTorrent.videoFiles.length})</h4>
                <div style={styles.filesList}>
                  {currentTorrent.videoFiles.map((file) => {
                    const isMain = mainMovieFile && file.id === mainMovieFile.id;
                    return (
                      <div
                        key={file.id}
                        style={isMain ? styles.fileRowMain : styles.fileRow}
                      >
                        <div style={styles.fileInfo}>
                          <span style={isMain ? styles.fileNameMain : styles.fileName}>{file.name}</span>
                          <span style={styles.fileSize}>{formatBytes(file.size)}</span>
                        </div>
                        <button
                          onClick={() => onPlay(currentTorrent.id, file.id, file.name, file.subtitles, currentTorrent.videoFiles)}
                          className="glass-button glass-button-primary"
                          style={styles.playButton}
                        >
                          <Play size={16} fill="currentColor" />
                          <span>Stream</span>
                        </button>
                      </div>
                    );
                  })}
                  {currentTorrent.videoFiles.length === 0 && (
                    <div style={styles.noFiles}>
                      <AlertTriangle size={24} color="var(--warning)" />
                      <span>No streamable video files found inside this torrent.</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TV Show Seasons & Episodes */}
            {isTV && (
              <div style={styles.tvSection}>
                <div style={styles.tvHeader}>
                  <h4 style={styles.sectionTitle}>Episodes</h4>
                  <select 
                    value={selectedSeason} 
                    onChange={(e) => setSelectedSeason(parseInt(e.target.value, 10))}
                    className="glass-input"
                    style={styles.seasonSelect}
                  >
                    {seasonsList.map(s => (
                      <option key={s} value={s} style={{ background: '#12121c', color: '#fff' }}>
                        Season {s}
                      </option>
                    ))}
                  </select>
                </div>

                {episodesLoading && (
                  <div style={styles.loadingBox}>
                    <Loader2Spinner />
                    <span>Loading season details...</span>
                  </div>
                )}

                {episodesError && (
                  <div style={styles.errorBox}>
                    <AlertTriangle size={20} color="var(--error)" />
                    <span>{episodesError}</span>
                  </div>
                )}

                {!episodesLoading && !episodesError && (
                  <div style={styles.episodesList}>
                    {episodes.map((episode) => {
                      const matchedFile = findFileForEpisode(episode.episode_number);
                      return (
                        <div key={episode.id} style={styles.episodeRow}>
                          <div style={styles.episodeMain}>
                            <div style={styles.episodeInfo}>
                              <span style={styles.episodeNumber}>Episode {episode.episode_number}</span>
                              <h5 style={styles.episodeTitle}>{episode.name}</h5>
                              <p style={styles.episodeDesc}>{episode.overview || "No episode overview available."}</p>
                            </div>
                            
                            <div style={styles.episodeActions}>
                              {matchedFile ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                                  <button
                                    onClick={() => onPlay(currentTorrent.id, matchedFile.id, matchedFile.name, matchedFile.subtitles, currentTorrent.videoFiles)}
                                    className="glass-button glass-button-primary"
                                    style={styles.playButton}
                                  >
                                    <Play size={14} fill="currentColor" />
                                    <span>Play ({formatBytes(matchedFile.size)})</span>
                                  </button>
                                  <span style={styles.downloadedBadge}>Downloaded</span>
                                </div>
                              ) : (
                                <span style={styles.missingBadge}>Not Downloaded</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {episodes.length === 0 && (
                      <div style={styles.noEpisodes}>
                        <Info size={20} color="var(--text-muted)" />
                        <span>No episode metadata returned from TMDb. Playing direct files instead:</span>

                        <div style={{ ...styles.filesList, width: '100%', marginTop: '12px' }}>
                          {currentTorrent.videoFiles.map((file) => (
                            <div key={file.id} style={styles.fileRow}>
                              <div style={styles.fileInfo}>
                                <span style={styles.fileName}>{file.name}</span>
                                <span style={styles.fileSize}>{formatBytes(file.size)}</span>
                              </div>
                              <button
                                onClick={() => onPlay(currentTorrent.id, file.id, file.name, file.subtitles, currentTorrent.videoFiles)}
                                className="glass-button glass-button-primary"
                                style={styles.playButton}
                              >
                                <Play size={16} fill="currentColor" />
                                <span>Stream</span>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};

// Minor Loading Component
const Loader2Spinner = () => (
  <div style={{
    width: '24px',
    height: '24px',
    border: '2px solid rgba(255, 255, 255, 0.1)',
    borderLeftColor: 'var(--accent-primary)',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  }} />
);

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    background: 'rgba(0, 0, 0, 0.8)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '24px',
  },
  container: {
    width: '100%',
    maxWidth: '960px',
    maxHeight: '90vh',
    overflowY: 'auto',
    position: 'relative',
    backgroundSize: 'cover',
    backgroundPosition: 'center 20%',
    backgroundRepeat: 'no-repeat',
  },
  closeButton: {
    position: 'absolute',
    top: '20px',
    right: '20px',
    background: 'rgba(0, 0, 0, 0.5)',
    border: '1px solid var(--glass-border)',
    color: '#ffffff',
    borderRadius: '50%',
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    zIndex: 10,
    transition: 'var(--transition-smooth)',
    outline: 'none',
  },
  layout: {
    display: 'grid',
    gridTemplateColumns: '260px 1fr',
    gap: '32px',
    padding: '40px',
    minHeight: '400px',
    boxSizing: 'border-box',
  },
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  poster: {
    width: '100%',
    borderRadius: '12px',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  noPoster: {
    width: '100%',
    aspectRatio: '2/3',
    background: 'rgba(255, 255, 255, 0.03)',
    borderRadius: '12px',
    border: '1px dashed var(--glass-border)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    color: 'var(--text-secondary)',
  },
  sourceSelector: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  sourceLabel: {
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  sourceSelect: {
    padding: '8px 10px',
    fontSize: '12px',
    borderRadius: '8px',
    cursor: 'pointer',
    width: '100%',
  },
  torrentMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '16px',
    background: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '12px',
    border: '1px solid rgba(255, 255, 255, 0.05)',
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '13px',
  },
  metaLabel: {
    color: 'var(--text-muted)',
  },
  metaVal: {
    fontWeight: '500',
    color: 'var(--text-primary)',
  },
  mainContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    minWidth: 0,
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    alignItems: 'flex-start',
  },
  badge: {
    fontSize: '10px',
    fontWeight: '700',
    textTransform: 'uppercase',
    color: 'var(--accent-primary)',
    background: 'rgba(0, 242, 254, 0.08)',
    border: '1px solid rgba(0, 242, 254, 0.2)',
    padding: '4px 10px',
    borderRadius: '20px',
    letterSpacing: '0.05em',
  },
  title: {
    fontSize: '32px',
    fontWeight: '800',
    fontFamily: 'var(--font-display)',
    lineHeight: '1.2',
  },
  subHeader: {
    display: 'flex',
    gap: '16px',
    color: 'var(--text-secondary)',
    fontSize: '14px',
  },
  rating: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  year: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  genresRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
  },
  genreBadge: {
    fontSize: '12px',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    padding: '6px 12px',
    borderRadius: '8px',
    color: 'var(--text-secondary)',
  },
  overviewSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  sectionTitle: {
    fontSize: '16px',
    color: 'var(--text-primary)',
    fontWeight: '600',
    letterSpacing: '0.02em',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    paddingBottom: '8px',
  },
  overview: {
    fontSize: '15px',
    color: 'var(--text-secondary)',
    lineHeight: '1.6',
  },
  filesSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  filesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  fileRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    borderRadius: '8px',
    gap: '16px',
  },
  fileRowMain: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 16px',
    background: 'rgba(0, 242, 254, 0.03)',
    border: '1px solid rgba(0, 242, 254, 0.15)',
    borderRadius: '8px',
    gap: '16px',
  },
  fileInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: 0,
  },
  fileName: {
    fontSize: '14px',
    fontWeight: '500',
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  fileNameMain: {
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--accent-primary)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  fileSize: {
    fontSize: '12px',
    color: 'var(--text-muted)',
  },
  playButton: {
    padding: '6px 14px',
    fontSize: '13px',
    borderRadius: '6px',
    flexShrink: 0,
  },
  noFiles: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '24px',
    background: 'rgba(255, 255, 255, 0.01)',
    border: '1px dashed var(--glass-border)',
    borderRadius: '12px',
    color: 'var(--text-secondary)',
  },
  tvSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  tvHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  seasonSelect: {
    padding: '6px 12px',
    fontSize: '14px',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  loadingBox: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '40px',
    color: 'var(--text-secondary)',
  },
  errorBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '16px',
    background: 'rgba(255, 77, 77, 0.05)',
    border: '1px solid rgba(255, 77, 77, 0.15)',
    borderRadius: '8px',
    color: 'var(--error)',
  },
  episodesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    maxHeight: '400px',
    overflowY: 'auto',
    paddingRight: '6px',
  },
  episodeRow: {
    background: 'rgba(255, 255, 255, 0.02)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderRadius: '8px',
    padding: '16px',
    transition: 'var(--transition-smooth)',
  },
  episodeMain: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '20px',
  },
  episodeInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flexGrow: 1,
  },
  episodeNumber: {
    fontSize: '10px',
    fontWeight: '700',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
  },
  episodeTitle: {
    fontSize: '15px',
    fontWeight: '600',
    color: '#ffffff',
  },
  episodeDesc: {
    fontSize: '13px',
    color: 'var(--text-secondary)',
    lineHeight: '1.4',
    marginTop: '4px',
  },
  episodeActions: {
    flexShrink: 0,
  },
  downloadedBadge: {
    fontSize: '10px',
    color: 'var(--success)',
    background: 'rgba(34, 197, 94, 0.08)',
    border: '1px solid rgba(34, 197, 94, 0.2)',
    padding: '2px 6px',
    borderRadius: '4px',
    fontWeight: '600',
    alignSelf: 'center',
    textAlign: 'center',
  },
  missingBadge: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    padding: '6px 12px',
    borderRadius: '6px',
    fontWeight: '500',
    display: 'inline-block',
  },
  noEpisodes: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '24px',
    background: 'rgba(255, 255, 255, 0.01)',
    border: '1px dashed var(--glass-border)',
    borderRadius: '12px',
    color: 'var(--text-secondary)',
    textAlign: 'center',
  },
  trailerBtn: {
    padding: '5px 12px',
    fontSize: '13px',
    borderRadius: '6px',
    height: 'auto',
  },
  castSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  castRow: {
    display: 'flex',
    gap: '12px',
    overflowX: 'auto',
    paddingBottom: '4px',
  },
  castCard: {
    flexShrink: 0,
    width: '80px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  castPhoto: {
    width: '80px',
    height: '110px',
    objectFit: 'cover',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.08)',
  },
  castNoPhoto: {
    width: '80px',
    height: '110px',
    borderRadius: '8px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  castName: {
    fontSize: '11px',
    fontWeight: '600',
    color: 'var(--text-primary)',
    lineHeight: '1.3',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
  castChar: {
    fontSize: '10px',
    color: 'var(--text-muted)',
    lineHeight: '1.3',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
  },
};
