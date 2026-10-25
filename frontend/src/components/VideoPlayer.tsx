import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft, Copy, ExternalLink, Loader2, Check,
  RotateCw, RefreshCw, X, Play, Pause, Rewind, FastForward,
  Volume2, VolumeX, Maximize, Minimize, Subtitles, PictureInPicture2, Search, Monitor, List
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import type { SubtitleTrack, VideoFile, TorrentMetadata } from '../types';
import { apiUrl, isOwnApiUrl, proxyStreamUrl, withMediaToken } from '../lib/api';
import { parseEpisodeFromFile, formatTime } from '../lib/utils';
import { useProgressPersistence } from '../hooks/useProgressPersistence';
import { usePlayerUrl } from '../hooks/usePlayerUrl';
import Hls from 'hls.js';

interface VideoPlayerProps {
  torrentId?: number | string;
  fileId?: number | string;
  filename?: string;
  subtitles?: SubtitleTrack[];
  onClose: () => void;
  videoFiles?: VideoFile[];
  torrentMetadata?: TorrentMetadata;
  mediaTitle?: string;
  onPlayNext?: (fileId: number, filename: string, subtitles: SubtitleTrack[]) => void;
  /** Direct external stream/embed URL supplied by the source picker (VidSrc, 2Embed, etc.). */
  externalUrl?: string;
  externalKind?: 'embed' | 'stream';
  externalLabel?: string;
  /** TV metadata: enables the in-player episode switcher. */
  tmdbType?: 'movie' | 'tv';
  tmdbId?: number;
  tmdbSeason?: number;
  tmdbEpisode?: number;
  /** Fallback when an episode can't be switched locally (parent re-navigates). */
  onEpisodeSelect?: (season: number, episode: number) => void;
  /** Poster/backdrop shown behind the video before/while it loads. */
  poster?: string;
  /** When provided, shows a "Change Source" action in the top bar. */
  onChangeSource?: () => void;
}

const LANG_MAP: Record<string, string> = {
  eng: 'English', en: 'English',
  spa: 'Spanish', es: 'Spanish',
  fre: 'French', fra: 'French', fr: 'French',
  ger: 'German', deu: 'German', de: 'German',
  ita: 'Italian', it: 'Italian',
  por: 'Portuguese', pt: 'Portuguese',
  jpn: 'Japanese', ja: 'Japanese',
  kor: 'Korean', ko: 'Korean',
  chi: 'Chinese', zho: 'Chinese', zh: 'Chinese',
  hin: 'Hindi', hi: 'Hindi',
  ara: 'Arabic', ar: 'Arabic',
  rus: 'Russian', ru: 'Russian',
  und: 'Unknown',
};

const VOLUME_KEY = 'sv-volume';
const SS_KEY = 'sv-subtitle-style';

interface SubtitleStyle {
  size: 'sm' | 'md' | 'lg' | 'xl';
  color: string;
  bgOpacity: number;
  bold: boolean;
  shadow: boolean;
}
const DEFAULT_SS: SubtitleStyle = { size: 'md', color: '#ffffff', bgOpacity: 0.6, bold: false, shadow: true };

interface OSSubOption {
  fileId: number;
  language: string;
  displayName: string;
  downloadCount: number;
  fileName?: string;
}

const SIZE_MAP: Record<SubtitleStyle['size'], string> = { sm: '0.8em', md: '1em', lg: '1.3em', xl: '1.65em' };
const COLOR_PRESETS = [
  { label: 'White', value: '#ffffff' },
  { label: 'Yellow', value: '#ffed4a' },
  { label: 'Cyan', value: '#00f2fe' },
  { label: 'Green', value: '#22c55e' },
];

function langDisplayName(code: string): string {
  const lower = code.slice(0, 2).toLowerCase();
  return LANG_MAP[lower] || LANG_MAP[code.toLowerCase()] || code;
}

// Every OpenSubtitles result needs its own track label: several releases can share one
// language, and the label is how a track gets activated (and how the injection effect
// avoids adding duplicates). The "(OpenSubtitles)" suffix must stay: activateTrackByLabel
// uses it to keep preloaded OS tracks in 'hidden' rather than 'disabled'.
function osTrackLabel(sub: { language: string; fileName?: string }): string {
  const short = (sub.fileName || '').replace(/\.(srt|ass|ssa|vtt|sub)$/i, '').trim().slice(0, 52);
  const lang = langDisplayName(sub.language);
  return short ? `${lang} - ${short} (OpenSubtitles)` : `${lang} (OpenSubtitles)`;
}

function isHlsUrl(url: string | null | undefined): boolean {
  return !!url && /\.m3u8/i.test(url);
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  torrentId,
  fileId,
  filename = '',
  subtitles = [],
  onClose,
  videoFiles = [],
  torrentMetadata,
  mediaTitle,
  onPlayNext,
  externalUrl,
  externalKind = 'embed',
  externalLabel,
  poster,
  onChangeSource,
  tmdbType,
  tmdbId,
  tmdbSeason,
  tmdbEpisode,
  onEpisodeSelect,
}) => {
  const { token } = useAuth();
  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const isExternal = !!externalUrl;
  const isExternalStream = isExternal && externalKind === 'stream';

  // Backend-proxied HLS URLs need the JWT so /api/proxy can authenticate
  // (query token matches the /api/ffstream pattern; works for hls.js + native).
  const buildExternalUrl = (url: string): string => {
    const proxied = proxyStreamUrl(url);
    if (!token || !proxied.includes('/api/proxy?')) return proxied;
    // Attach the token ONLY when the URL is our own API. Scrape results carry URLs taken
    // from third-party HTML, so a url of the form https://evil.tld/api/proxy?x=1 used to
    // receive the raw 30-day session token in its query string.
    if (!isOwnApiUrl(proxied)) return proxied;
    return `${proxied}${proxied.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`;
  };

  // When there's no real torrentId/fileId (library item), use a lib: sentinel for progress keys
  const effectiveTorrentId = torrentId ?? (torrentMetadata?.tmdbId ? `lib:${torrentMetadata.tmdbId}` : 'lib');
  const effectiveFileId = fileId ?? 0;
  const canUseDirect = torrentId !== undefined && fileId !== undefined;

  const progress = useProgressPersistence(effectiveTorrentId, effectiveFileId);
  const playerUrls = usePlayerUrl(torrentMetadata);
  const hasEmbedUrl = !!(playerUrls.vidking || playerUrls.vidsrc || playerUrls.vidlink);

  type VideoMode = 'vidking' | 'vidsrc' | 'vidlink' | 'direct';
  const [mode, setMode] = useState<VideoMode>(() => {
    if (isExternalStream) return 'direct';
    // A TorBox torrent/file (or a local library file) is a real playable source: play the
    // file itself. Without this, playerUrls.vidking wins whenever the title has a tmdbId,
    // so a TorBox pick silently falls back to the VidKing embed.
    if (canUseDirect) return 'direct';
    if (playerUrls.vidking) return 'vidking';
    if (playerUrls.vidsrc) return 'vidsrc';
    if (playerUrls.vidlink) return 'vidlink';
    return 'direct';
  });
  const [iframeLoading, setIframeLoading] = useState(true);

  // --- Episode switcher state ---
  const isTv = tmdbType === 'tv' && !!tmdbId;
  const [showEpisodes, setShowEpisodes] = useState(false);
  const [epSeasons, setEpSeasons] = useState<{ season_number: number; name: string }[]>([]);
  const [epSeason, setEpSeason] = useState<number | null>(tmdbSeason ?? null);
  const [episodes, setEpisodes] = useState<{ id: number; episode_number: number; name: string }[]>([]);
  const [epLoading, setEpLoading] = useState(false);
  const [embedUrl, setEmbedUrl] = useState<string | null>(externalUrl ?? null);
  const fileEp = parseEpisodeFromFile(filename);
  const currentSeason = tmdbSeason ?? fileEp?.season ?? epSeason ?? 1;
  const currentEpisode = tmdbEpisode ?? fileEp?.episode;

  // Keep the in-player embed URL in sync when the parent switches sources.
  useEffect(() => {
    setEmbedUrl(externalUrl ?? null);
  }, [externalUrl]);

  const [directUrl, setDirectUrl] = useState<string | null>(isExternalStream ? buildExternalUrl(externalUrl ?? '') : null);
  const [directLoading, setDirectLoading] = useState(false);
  const [directError, setDirectError] = useState('');

  // Fetch the season list for the episode switcher.
  useEffect(() => {
    if (!isTv || !showEpisodes || !token) return;
    let cancelled = false;
    setEpLoading(true);
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/tmdb/tv/${tmdbId}`), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (!cancelled && json?.success && Array.isArray(json.data?.seasons)) {
          const seasons = json.data.seasons.filter((s: any) => s.season_number > 0);
          setEpSeasons(seasons);
          if (epSeason == null && seasons.length) setEpSeason(seasons[0].season_number);
        }
      } catch { /* ignore */ } finally {
        if (!cancelled) setEpLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTv, showEpisodes, tmdbId, token]);

  // Fetch the episode list for the selected season.
  useEffect(() => {
    if (!isTv || !showEpisodes || !epSeason || !token) return;
    let cancelled = false;
    setEpLoading(true);
    (async () => {
      try {
        const res = await fetch(apiUrl(`/api/tmdb/tv/${tmdbId}/season/${epSeason}`), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (!cancelled && json?.success) setEpisodes(json.data?.episodes ?? []);
      } catch { /* ignore */ } finally {
        if (!cancelled) setEpLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isTv, showEpisodes, epSeason, tmdbId, token]);

  const [buffering, setBuffering] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(() => {
    const stored = parseFloat(localStorage.getItem(VOLUME_KEY) || '');
    return isNaN(stored) ? 1 : Math.max(0, Math.min(1, stored));
  });
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [theater, setTheater] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekingRef = useRef(false);
  const progressRef = useRef<HTMLDivElement>(null);

  const [nextEpisode, setNextEpisode] = useState<VideoFile | null>(null);
  const [nextEpisodeCountdown, setNextEpisodeCountdown] = useState(10);
  const creditsTriggeredRef = useRef(false);

  const [isPiP, setIsPiP] = useState(false);
  const [osSubtitles, setOsSubtitles] = useState<OSSubOption[]>([]);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(() => {
    try { return { ...DEFAULT_SS, ...JSON.parse(localStorage.getItem(SS_KEY) || '{}') }; }
    catch { return DEFAULT_SS; }
  });

  useEffect(() => {
    creditsTriggeredRef.current = false;
    setNextEpisode(null);
    setNextEpisodeCountdown(10);
  }, [fileId]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) setShowHelp(h => !h);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const findNextEpisodeFile = useCallback((): VideoFile | null => {
    if (!torrentMetadata?.parsed || videoFiles.length === 0) return null;
    const currentEp = torrentMetadata.parsed.episode;
    const currentSeason = torrentMetadata.parsed.season;
    if (currentEp === undefined || currentEp === null) return null;
    const nextEpNum = currentEp + 1;
    const season = currentSeason || 1;
    for (const vf of videoFiles) {
      const parsed = parseEpisodeFromFile(vf.name);
      if (!parsed) continue;
      if (parsed.episode === nextEpNum && (parsed.season === -1 || parsed.season === season)) return vf;
    }
    return null;
  }, [torrentMetadata, videoFiles]);

  useEffect(() => {
    if (!nextEpisode || !onPlayNext) return;
    if (nextEpisodeCountdown <= 0) {
      onPlayNext(nextEpisode.id, nextEpisode.name, nextEpisode.subtitles);
      return;
    }
    const timer = window.setTimeout(() => setNextEpisodeCountdown(c => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [nextEpisode, nextEpisodeCountdown, onPlayNext]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (video && !video.paused) setControlsVisible(false);
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      hlsRef.current?.destroy();
    };
  }, []);

  // Attach hls.js for external HLS streams (Chrome/Edge can't play m3u8 natively).
  useEffect(() => {
    if (!directUrl || !isHlsUrl(directUrl)) return;
    const video = videoRef.current;
    if (!video || !Hls.isSupported()) return;
    const hls = new Hls();
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (data.fatal) {
        setDirectError('The stream failed to load. This source may be down — try another source.');
        hls.destroy();
        hlsRef.current = null;
      }
    });
    hls.loadSource(directUrl);
    hls.attachMedia(video);
    hlsRef.current = hls;
    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
  }, [directUrl]);

  // Fetch direct CDN URL whenever we enter direct mode
  useEffect(() => {
    if (externalUrl) return; // source URL already supplied by the source picker
    if (mode !== 'direct' || !token) return;
    let cancelled = false;

    // Handle local files
    if (typeof torrentId === 'string' && torrentId.startsWith('local:')) {
      const filename = torrentId.replace('local:', '');
      setDirectUrl(withMediaToken(apiUrl(`/api/local/stream/${encodeURIComponent(filename)}`), token));
      setDirectLoading(false);
      return () => { cancelled = true; };
    }

    if (!canUseDirect) return;
    setDirectLoading(true);
    setDirectError('');
    setDirectUrl(null);
    fetch(apiUrl(`/api/stream/${torrentId}/${fileId}`), {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.success) setDirectUrl(data.streamUrl);
        else setDirectError(data.detail || 'Failed to get stream URL.');
      })
      .catch(() => { if (!cancelled) setDirectError('Failed to fetch stream URL.'); })
      .finally(() => { if (!cancelled) setDirectLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, token, torrentId, fileId, externalUrl]);

  // Wire up native video event listeners when direct URL is ready
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !directUrl) return;

    const savedVol = parseFloat(localStorage.getItem(VOLUME_KEY) || '');
    if (!isNaN(savedVol)) video.volume = Math.max(0, Math.min(1, savedVol));

    let lastSaveTime = 0;

    const onPlay = () => setPlaying(true);
    const onPause = () => { setPlaying(false); progress.saveProgress(video, true); };
    const onTimeUpdate = () => {
      if (!seekingRef.current) setCurrentTime(video.currentTime);
      const now = Date.now();
      if (now - lastSaveTime >= 5000) {
        lastSaveTime = now;
        progress.saveProgress(video);
      }
      const dur = video.duration;
      const cur = video.currentTime;
      if (
        settingsRef.current.autoPlayNextEpisode &&
        !creditsTriggeredRef.current &&
        dur && dur > 0 && cur / dur >= 0.95
      ) {
        const next = findNextEpisodeFile();
        if (next && onPlayNext) {
          creditsTriggeredRef.current = true;
          setNextEpisode(next);
          setNextEpisodeCountdown(10);
        }
      }
    };
    const onLoadedMetadata = () => {
      setDuration(video.duration);
      if (settingsRef.current.resumeWatching) {
        const savedTime = progress.restorePosition(video);
        if (savedTime !== null) {
          setResumedFrom(savedTime);
          setTimeout(() => setResumedFrom(null), 8000);
        }
      }
    };
    const onDurationChange = () => setDuration(video.duration);
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => { setBuffering(false); setPlaying(true); };
    const onCanPlay = () => setBuffering(false);
    const onVolumeChange = () => {
      setVolume(video.volume);
      setMuted(video.muted);
      if (!video.muted) localStorage.setItem(VOLUME_KEY, String(video.volume));
    };
    const onProgress = () => {
      const buf = video.buffered;
      if (buf.length > 0) setBufferedEnd(buf.end(buf.length - 1));
    };
    const onRateChange = () => setPlaybackRate(video.playbackRate);
    const onEnded = () => {
      progress.clearProgress();
      if (settingsRef.current.autoPlayNextEpisode && !creditsTriggeredRef.current) {
        const next = findNextEpisodeFile();
        if (next && onPlayNext) { setNextEpisode(next); setNextEpisodeCountdown(10); }
      }
    };
    const onEnterPiP = () => setIsPiP(true);
    const onLeavePiP = () => setIsPiP(false);

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('progress', onProgress);
    video.addEventListener('ratechange', onRateChange);
    video.addEventListener('ended', onEnded);
    video.addEventListener('enterpictureinpicture', onEnterPiP);
    video.addEventListener('leavepictureinpicture', onLeavePiP);

    return () => {
      progress.saveProgress(video, true);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('ratechange', onRateChange);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('enterpictureinpicture', onEnterPiP);
      video.removeEventListener('leavepictureinpicture', onLeavePiP);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directUrl]);

  // Keyboard shortcuts — direct mode only
  useEffect(() => {
    if (mode !== 'direct') return;
    const onKey = (e: KeyboardEvent) => {
      const video = videoRef.current;
      if (!video || (e.target as HTMLElement).tagName === 'INPUT') return;
      switch (e.key) {
        case ' ': case 'k':
          e.preventDefault();
          if (video.paused) video.play(); else video.pause();
          break;
        case 'f':
          e.preventDefault();
          if (document.fullscreenElement) document.exitFullscreen();
          else containerRef.current?.requestFullscreen();
          break;
        case 't':
          e.preventDefault();
          setTheater(t => !t);
          break;
        case 'm':
          e.preventDefault();
          video.muted = !video.muted;
          break;
        case 'ArrowLeft':
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 10);
          break;
        case 'ArrowRight':
          e.preventDefault();
          video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  // Inject OS subtitle <track> elements when available and preload them
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !osSubtitles.length || mode !== 'direct') return;
    // If the torrent shipped no subtitle files of its own, turn the most-downloaded English
    // OpenSubtitles track on automatically so subs just appear (results are ordered by
    // download count, so the first English one is the popular pick).
    const autoFileId = subtitles.length === 0
      ? (osSubtitles.find(s => (s.language || '').toLowerCase().startsWith('en'))?.fileId ?? null)
      : null;
    osSubtitles.forEach(sub => {
      const label = osTrackLabel(sub);
      const exists = Array.from(video.getElementsByTagName('track')).some(t => t.label === label);
      if (exists) return;
      const trackEl = document.createElement('track');
      trackEl.kind = 'subtitles';
      trackEl.src = withMediaToken(apiUrl(`/api/opensubs/${sub.fileId}`), token);
      trackEl.srclang = sub.language;
      trackEl.label = label;
      video.appendChild(trackEl);
      // Set to hidden (not disabled) so the browser fetches and parses the VTT.
      // Tracks left in 'disabled' are never loaded, so switching to 'showing' later shows nothing.
      trackEl.track.mode = (autoFileId != null && sub.fileId === autoFileId) ? 'showing' : 'hidden';
    });
  }, [osSubtitles, mode]);

  // ::cue subtitle style injection
  useEffect(() => {
    const bg = `rgba(0,0,0,${subtitleStyle.bgOpacity.toFixed(2)})`;
    const shadow = subtitleStyle.shadow
      ? '1px 1px 3px rgba(0,0,0,0.95),-1px -1px 3px rgba(0,0,0,0.95)'
      : 'none';
    const css = `::cue{color:${subtitleStyle.color};background-color:${bg};font-size:${SIZE_MAP[subtitleStyle.size]};font-weight:${subtitleStyle.bold ? 'bold' : 'normal'};text-shadow:${shadow};}`;
    let el = document.getElementById('sv-cue-style') as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = 'sv-cue-style';
      document.head.appendChild(el);
    }
    el.textContent = css;
    localStorage.setItem(SS_KEY, JSON.stringify(subtitleStyle));
  }, [subtitleStyle]);

  // Fetch OpenSubtitles results
  useEffect(() => {
    if (!torrentMetadata?.tmdbId || !token) return;
    const type = torrentMetadata.type === 'tv' ? 'tv' : 'movie';
    // TV: OpenSubtitles returns nothing without season/episode, so send them when we know them.
    const seasonQ = type === 'tv' && currentSeason ? `&season=${currentSeason}` : '';
    const episodeQ = type === 'tv' && currentEpisode ? `&episode=${currentEpisode}` : '';
    fetch(apiUrl(`/api/opensubs/search?tmdbId=${torrentMetadata.tmdbId}&type=${type}${seasonQ}${episodeQ}`), {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => {
        if (data.success && Array.isArray(data.data)) {
          const torrentLangs = new Set(subtitles.map(s => s.lang.slice(0, 2).toLowerCase()));
          setOsSubtitles((data.data as OSSubOption[]).filter(
            s => !torrentLangs.has(s.language.toLowerCase())
          ));
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [torrentMetadata?.tmdbId, torrentMetadata?.type, currentSeason, currentEpisode]);

  const handleCopyLink = useCallback(() => {
    if (!directUrl) return;
    navigator.clipboard.writeText(directUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [directUrl]);


  const startOver = useCallback(() => {
    const video = videoRef.current;
    if (video) video.currentTime = 0;
    progress.clearProgress();
    setResumedFrom(null);
  }, [progress]);

  const retryDirect = useCallback(() => {
    setDirectError('');
    if (isExternalStream) {
      setDirectUrl(buildExternalUrl(externalUrl ?? ''));
    } else {
      setDirectUrl(null); // re-triggers the /api/stream fetch
    }
  }, [isExternalStream, externalUrl]);

  const handleCycleMode = useCallback(() => {
    setMode(prev => {
      if (prev === 'vidking') return playerUrls.vidsrc ? 'vidsrc' : (playerUrls.vidlink ? 'vidlink' : (canUseDirect ? 'direct' : 'vidking'));
      if (prev === 'vidsrc') return playerUrls.vidlink ? 'vidlink' : (canUseDirect ? 'direct' : (playerUrls.vidking ? 'vidking' : 'vidsrc'));
      if (prev === 'vidlink') return canUseDirect ? 'direct' : (playerUrls.vidking ? 'vidking' : (playerUrls.vidsrc ? 'vidsrc' : 'vidlink'));
      return playerUrls.vidking ? 'vidking' : (playerUrls.vidsrc ? 'vidsrc' : (playerUrls.vidlink ? 'vidlink' : 'direct'));
    });
    setIframeLoading(true);
  }, [playerUrls, canUseDirect]);

  const handleEpisodeSelect = useCallback((season: number, episode: number) => {
    // 1) External embed: rewrite the /tv/{id}/{s}/{e} URL in place.
    if (externalKind === 'embed') {
      const src = embedUrl ?? externalUrl;
      if (src) {
        const rewritten = src.replace(/(\/tv\/\d+\/)\d+\/\d+/, `$1${season}/${episode}`);
        if (rewritten !== src) {
          setEmbedUrl(rewritten);
          setIframeLoading(true);
          setShowEpisodes(false);
          return;
        }
      }
    }
    // 2) TorBox files: switch to the matching local video file.
    if (videoFiles.length) {
      const match = videoFiles.find(f => {
        const p = parseEpisodeFromFile(f.name);
        return p && p.episode === episode && (p.season === season || p.season < 0);
      });
      if (match) {
        setShowEpisodes(false);
        onPlayNext?.(match.id, match.name, match.subtitles);
        return;
      }
    }
    // 3) Parent fallback (e.g. re-scrape the new episode).
    setShowEpisodes(false);
    onEpisodeSelect?.(season, episode);
  }, [embedUrl, externalUrl, externalKind, videoFiles, onPlayNext, onEpisodeSelect, epSeason]);

  return (
    <div
      ref={containerRef}
      style={styles.playerContainer}
      className={`sv-player${mode === 'direct' && !controlsVisible ? ' sv-cursor-hidden' : ''}`}
      onMouseMove={mode === 'direct' ? showControls : undefined}
      onMouseLeave={mode === 'direct' ? () => {
        const video = videoRef.current;
        if (video && !video.paused) setControlsVisible(false);
      } : undefined}
    >
      {/* Top bar */}
      <div style={styles.topBar} className="sv-fade-in">
        <button onClick={onClose} style={styles.backButton} title="Go Back" aria-label="Go back">
          <ArrowLeft size={22} />
        </button>
        <div style={styles.titleInfo}>
          <span style={styles.nowPlaying}>NOW PLAYING</span>
          <h3 style={styles.videoTitle}>{mediaTitle || filename.split('/').pop()}</h3>
        </div>
        <div style={styles.topActions}>
          {!isExternal && hasEmbedUrl && (
            <button
              onClick={handleCycleMode}
              className="glass-button"
              style={{
                ...styles.actionButton,
                color: mode !== 'direct' ? 'var(--accent-primary)' : 'var(--text-secondary)',
                borderColor: mode !== 'direct' ? 'rgba(0,242,254,0.35)' : undefined,
              }}
              title="Cycle video source"
            >
              {mode === 'vidking' ? 'Source: VidKing' : mode === 'vidsrc' ? 'Source: VidSrc' : mode === 'vidlink' ? 'Source: VidLink' : 'Source: Direct'}
            </button>
          )}
          {mode === 'direct' && (
            <button
              onClick={() => setTheater(t => !t)}
              className="glass-button"
              style={{
                ...styles.actionButton,
                color: theater ? 'var(--accent-primary)' : 'var(--text-secondary)',
                borderColor: theater ? 'rgba(0,242,254,0.35)' : undefined,
              }}
              title="Toggle theater mode (T)"
            >
              <Monitor size={16} />
              Theater
            </button>
          )}
          {isTv && (
            <button
              onClick={() => setShowEpisodes(p => !p)}
              className="glass-button"
              style={{
                ...styles.actionButton,
                color: showEpisodes ? 'var(--accent-primary)' : 'var(--text-secondary)',
                borderColor: showEpisodes ? 'rgba(0,242,254,0.35)' : undefined,
              }}
              title="Switch episode"
            >
              <List size={16} />
              Episodes
            </button>
          )}
          {onChangeSource && (
            <button
              onClick={onChangeSource}
              className="glass-button"
              style={styles.actionButton}
              title="Find another source"
            >
              <RefreshCw size={16} />
              Change Source
            </button>
          )}
          {isExternalStream && (
            <span
              className="glass-button"
              style={{
                ...styles.actionButton,
                color: 'var(--accent-primary)',
                borderColor: 'rgba(0,242,254,0.35)',
                cursor: 'default',
              }}
            >
              Source: {externalLabel || 'Stream'}
            </span>
          )}
          {isExternal && externalKind === 'embed' && (
            <span
              className="glass-button"
              style={{
                ...styles.actionButton,
                color: 'var(--accent-primary)',
                borderColor: 'rgba(0,242,254,0.35)',
                cursor: 'default',
              }}
            >
              Source: {externalLabel || 'External'}
            </span>
          )}
          {mode === 'direct' && (
            <>
              <button
                onClick={handleCopyLink}
                className="glass-button"
                style={styles.actionButton}
                title="Copy stream link to clipboard"
                disabled={!directUrl}
              >
                {copied ? <Check size={16} color="#22c55e" /> : <Copy size={16} />}
                <span>{copied ? 'Copied!' : 'Copy Stream Link'}</span>
              </button>
              {directUrl && (
                <a
                  href={directUrl}
                  className="glass-button glass-button-primary"
                  style={styles.actionButton}
                  title="Open directly in VLC/MPV or start downloading"
                >
                  <ExternalLink size={16} />
                  <span>Open in External Player</span>
                </a>
              )}
            </>
          )}
        </div>
      </div>

      {/* Episode switcher panel */}
      {isTv && showEpisodes && (
        <div
          className="glass-panel"
          style={{
            position: 'absolute',
            top: 64,
            right: 16,
            zIndex: 30,
            width: 380,
            maxWidth: 'calc(100% - 32px)',
            maxHeight: '72%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: 'rgba(14,14,22,0.92)',
          }}
        >
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>Episodes</strong>
            <button onClick={() => setShowEpisodes(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }} title="Close">
              <X size={16} />
            </button>
          </div>
          {epSeasons.length > 0 && (
            <div style={{ padding: '10px 14px 0' }}>
              <select
                value={epSeason ?? ''}
                onChange={e => setEpSeason(parseInt(e.target.value, 10))}
                className="glass-input"
                style={{ width: '100%', padding: '8px 10px', fontSize: 14 }}
              >
                {epSeasons.map(s => (
                  <option key={s.season_number} value={s.season_number}>{s.name}</option>
                ))}
              </select>
            </div>
          )}
          <div style={{ padding: 12, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {epLoading ? (
              <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'center', padding: 18 }}>
                <Loader2 size={22} className="spinner" />
              </div>
            ) : episodes.length ? (
              episodes.map(ep => {
                const isCurrent = ep.episode_number === currentEpisode && currentSeason === (epSeason ?? currentSeason);
                return (
                  <button
                    key={ep.id ?? ep.episode_number}
                    onClick={() => handleEpisodeSelect(epSeason ?? 1, ep.episode_number)}
                    title={ep.name}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      alignItems: 'flex-start',
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: `1px solid ${isCurrent ? 'rgba(0,242,254,0.45)' : 'var(--glass-border)'}`,
                      background: isCurrent ? 'rgba(0,242,254,0.12)' : 'rgba(255,255,255,0.04)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-sans)',
                      textAlign: 'left',
                      minWidth: 0,
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: 13 }}>E{ep.episode_number}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                      {ep.name}
                    </span>
                  </button>
                );
              })
            ) : (
              <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-muted)', padding: 12 }}>
                No episodes listed
              </div>
            )}
          </div>
        </div>
      )}

      {/* External embed source (from the source picker) */}
      {isExternal && externalKind === 'embed' && (
        <>
          {iframeLoading && (
            <div style={styles.overlay}>
              <Loader2 size={42} className="spinner" />
              <p style={{ marginTop: '16px', color: 'rgba(255,255,255,0.55)', fontSize: '14px' }}>
                Loading {externalLabel || 'external source'}...
              </p>
            </div>
          )}
          <iframe
            src={embedUrl ?? externalUrl}
            style={{ ...styles.iframe, opacity: iframeLoading ? 0 : 1 }}
            allowFullScreen
            allow="fullscreen; autoplay; encrypted-media"
            onLoad={() => setIframeLoading(false)}
            title={mediaTitle || externalLabel || 'External stream'}
          />
        </>
      )}

      {/* Embed iframe (VidKing, VidSrc, or VidLink) */}
      {mode !== 'direct' && (mode === 'vidking' ? playerUrls.vidking : mode === 'vidsrc' ? playerUrls.vidsrc : playerUrls.vidlink) && (
        <>
          {iframeLoading && (
            <div style={styles.overlay}>
              <Loader2 size={42} className="spinner" />
              <p style={{ marginTop: '16px', color: 'rgba(255,255,255,0.55)', fontSize: '14px' }}>
                Loading {mode === 'vidking' ? 'VidKing' : mode === 'vidsrc' ? 'VidSrc' : 'VidLink'}…
              </p>
            </div>
          )}
          <iframe
            src={(mode === 'vidking' ? playerUrls.vidking : mode === 'vidsrc' ? playerUrls.vidsrc : playerUrls.vidlink)!}
            style={{ ...styles.iframe, opacity: iframeLoading ? 0 : 1 }}
            allowFullScreen
            allow="fullscreen; autoplay; encrypted-media"
            onLoad={() => setIframeLoading(false)}
            title={mediaTitle || filename}
          />
        </>
      )}

      {/* Direct mode */}
      {mode === 'direct' && (
        <>
          {directLoading && (
            <div style={styles.overlay}>
              <Loader2 size={42} className="spinner" />
              <p style={{ marginTop: '16px', color: 'rgba(255,255,255,0.55)', fontSize: '14px' }}>
                Fetching stream…
              </p>
            </div>
          )}

          {buffering && !directError && directUrl && (
            <div style={styles.bufferingIndicator}>
              <Loader2 size={42} className="spinner" />
            </div>
          )}

          {mode === 'direct' && directUrl && !directLoading && !directError && !buffering && !playing && (
            <button
              className="sv-center-play"
              onClick={() => {
                const v = videoRef.current;
                if (v) v.play();
              }}
              aria-label="Play"
            >
              <Play size={54} fill="currentColor" />
            </button>
          )}

          {poster && mode === 'direct' && (
            <div style={styles.backdrop} className="sv-backdrop">
              <img src={poster} alt="" />
            </div>
          )}

          {directError && (
            <div style={styles.overlay}>
              <div style={styles.errorBox}>
                <h2 style={{ color: 'var(--error)' }}>Playback Error</h2>
                <p style={{ marginTop: '8px' }}>{directError}</p>
                <div style={{ marginTop: '20px', display: 'flex', gap: '12px', justifyContent: 'center' }}>
                  <button onClick={onClose} className="glass-button">Close Player</button>
                  <button
                    onClick={retryDirect}
                    className="glass-button glass-button-primary"
                  >
                    Retry
                  </button>
                </div>
              </div>
            </div>
          )}

          {resumedFrom !== null && (
            <div className="glass-panel" style={styles.resumeToast}>
              <RotateCw size={16} color="var(--accent-primary)" />
              <span>Resumed from {formatTime(resumedFrom)}</span>
              <button onClick={startOver} style={styles.resumeToastBtn}>Start Over</button>
              <button onClick={() => setResumedFrom(null)} style={styles.resumeToastClose} title="Dismiss">
                <X size={14} />
              </button>
            </div>
          )}

          {directUrl && (
            <div
              style={styles.videoWrapper}
              onClick={() => {
                const v = videoRef.current;
                if (v) { if (v.paused) v.play(); else v.pause(); }
              }}
              onDoubleClick={() => {
                if (document.fullscreenElement) document.exitFullscreen();
                else containerRef.current?.requestFullscreen();
              }}
            >
              <video
                ref={videoRef}
                src={directUrl && isHlsUrl(directUrl) && Hls.isSupported() ? undefined : (directUrl ?? undefined)}
                style={styles.videoEl}
                poster={poster}
                crossOrigin="anonymous"
                autoPlay
                playsInline
              >
                {subtitles.map((sub, i) => (
                  <track
                    key={sub.id}
                    kind="subtitles"
                    src={withMediaToken(apiUrl(`/api/subtitles/${effectiveTorrentId}/${sub.id}?name=${encodeURIComponent(sub.name)}`), token)}
                    srcLang={sub.lang.slice(0, 2).toLowerCase()}
                    label={`${i + 1}. ${langDisplayName(sub.lang)}`}
                    default={i === 0 && subtitles.length === 1}
                  />
                ))}
              </video>
            </div>
          )}

          {directUrl && controlsVisible && (
            <PlayerControls
              videoRef={videoRef}
              containerRef={containerRef}
              token={token}
              playing={playing}
              currentTime={currentTime}
              duration={duration}
              bufferedEnd={bufferedEnd}
              volume={volume}
              muted={muted}
              playbackRate={playbackRate}
              isFullscreen={isFullscreen}
              isPiP={isPiP}
              subtitles={subtitles}
              osSubtitles={osSubtitles}
              subtitleStyle={subtitleStyle}
              setSubtitleStyle={setSubtitleStyle}
              showSpeedMenu={showSpeedMenu}
              setShowSpeedMenu={setShowSpeedMenu}
              progressRef={progressRef}
              seekingRef={seekingRef}
              setCurrentTime={setCurrentTime}
              onToggleHelp={() => setShowHelp(h => !h)}
            />
          )}
        </>
      )}

      {/* Next Episode overlay — shared across modes */}
      {nextEpisode && (
        <div style={styles.nextEpisodeOverlay}>
          <div style={styles.nextEpisodeBox}>
            <h3 style={styles.nextEpisodeTitle}>Next Episode</h3>
            <p style={styles.nextEpisodeFilename}>{nextEpisode.name.split('/').pop()}</p>
            <div style={styles.nextEpisodeButtons}>
              <button
                onClick={() => { creditsTriggeredRef.current = false; setNextEpisodeCountdown(10); setNextEpisode(null); }}
                className="glass-button"
                style={styles.nextEpisodeBtn}
              >
                Cancel
              </button>
              <button
                onClick={() => onPlayNext?.(nextEpisode.id, nextEpisode.name, nextEpisode.subtitles)}
                className="glass-button glass-button-primary"
                style={styles.nextEpisodeBtn}
              >
                Play Now
              </button>
            </div>
            <p style={styles.nextEpisodeCountdown}>Auto-playing in {nextEpisodeCountdown}s</p>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Help */}
      {showHelp && (
        <div style={styles.helpOverlay} onClick={() => setShowHelp(false)}>
          <div style={styles.helpBox} onClick={(e) => e.stopPropagation()}>
            <div style={styles.helpHeader}>
              <span style={styles.helpTitle}>Keyboard Shortcuts</span>
              <button onClick={() => setShowHelp(false)} style={styles.helpClose}><X size={16} /></button>
            </div>
            <div style={styles.helpGrid}>
              {([
                ['Space / K', 'Play / Pause'],
                ['←  /  →', 'Seek ±10 seconds'],
                ['↑  /  ↓', 'Volume ±10%'],
                ['F', 'Toggle Fullscreen'],
                ['M', 'Toggle Mute'],
                ['?', 'Toggle this help'],
              ] as [string, string][]).map(([key, desc]) => (
                <React.Fragment key={key}>
                  <kbd style={styles.helpKey}>{key}</kbd>
                  <span style={styles.helpDesc}>{desc}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Custom Player Controls (native HTMLVideoElement) ---
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

interface PlayerControlsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  token: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  isFullscreen: boolean;
  isPiP: boolean;
  subtitles: SubtitleTrack[];
  osSubtitles: OSSubOption[];
  subtitleStyle: SubtitleStyle;
  setSubtitleStyle: (s: SubtitleStyle) => void;
  showSpeedMenu: boolean;
  setShowSpeedMenu: (v: boolean) => void;
  progressRef: React.RefObject<HTMLDivElement | null>;
  seekingRef: React.MutableRefObject<boolean>;
  setCurrentTime: (v: number) => void;
  onToggleHelp: () => void;
}

const PlayerControls: React.FC<PlayerControlsProps> = ({
  videoRef, containerRef, token, playing, currentTime, duration, bufferedEnd,
  volume, muted, playbackRate, isFullscreen, isPiP,
  subtitles, osSubtitles, subtitleStyle, setSubtitleStyle,
  showSpeedMenu, setShowSpeedMenu,
  progressRef, seekingRef, setCurrentTime, onToggleHelp,
}) => {
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState(0);
  const [showSubtitlesMenu, setShowSubtitlesMenu] = useState(false);
  // Which OpenSubtitles language group is expanded in the subtitle menu (null = none).
  const [expandedOsLang, setExpandedOsLang] = useState<string | null>(null);
  const [showStylePanel, setShowStylePanel] = useState(false);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [subQuery, setSubQuery] = useState('');
  const [subResults, setSubResults] = useState<OSSubOption[]>([]);
  const [subSearching, setSubSearching] = useState(false);
  const [subError, setSubError] = useState('');

  const searchOpenSubtitles = useCallback(async () => {
    if (!subQuery.trim()) return;
    setSubSearching(true);
    setSubError('');
    setSubResults([]);
    try {
      const r = await fetch(apiUrl(`/api/opensubs/search?query=${encodeURIComponent(subQuery.trim())}`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await r.json();
      if (data.success) {
        setSubResults(data.data || []);
        if (!(data.data?.length)) setSubError('No results found.');
      } else {
        setSubError(data.detail || 'Search failed.');
      }
    } catch {
      setSubError('Network error.');
    } finally {
      setSubSearching(false);
    }
  }, [subQuery, token]);

  const addAndActivateSub = useCallback((sub: OSSubOption) => {
    const video = videoRef.current;
    if (!video) return;
    const label = osTrackLabel(sub);
    Array.from(video.getElementsByTagName('track')).forEach(t => {
      if (t.label === label) t.remove();
    });
    const trackEl = document.createElement('track');
    trackEl.kind = 'subtitles';
    trackEl.src = withMediaToken(apiUrl(`/api/opensubs/${sub.fileId}`), token);
    trackEl.srclang = sub.language;
    trackEl.label = label;
    const activate = () => {
      const tracks = video.textTracks;
      for (let i = 0; i < tracks.length; i++) {
        tracks[i].mode = tracks[i].label === label ? 'showing' : 'disabled';
      }
    };
    trackEl.addEventListener('load', activate);
    video.appendChild(trackEl);
    // mode='hidden' triggers the browser to fetch the VTT; 'load' fires when cues are ready.
    trackEl.track.mode = 'hidden';
    setShowSubtitlesMenu(false);
  }, [videoRef]);

  const activateTrackByLabel = useCallback((label: string | null) => {
    const video = videoRef.current;
    if (!video) return;
    const tracks = video.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (label !== null && track.label === label) {
        track.mode = 'showing';
      } else if (track.label.endsWith('(OpenSubtitles)')) {
        // Keep preloaded OS tracks in 'hidden' so they stay loaded for re-selection
        track.mode = 'hidden';
      } else {
        track.mode = 'disabled';
      }
    }
  }, [videoRef]);

  const seekTo = useCallback((frac: number) => {
    const video = videoRef.current;
    if (!video || !video.duration) return;
    const time = Math.max(0, Math.min(video.duration, frac * video.duration));
    video.currentTime = time;
    setCurrentTime(time);
  }, [videoRef, setCurrentTime]);

  const handleProgressClick = useCallback((e: React.MouseEvent) => {
    const rect = progressRef.current?.getBoundingClientRect();
    if (!rect) return;
    seekTo((e.clientX - rect.left) / rect.width);
  }, [progressRef, seekTo]);

  const handleProgressHover = useCallback((e: React.MouseEvent) => {
    const rect = progressRef.current?.getBoundingClientRect();
    if (!rect || !duration) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverTime(frac * duration);
    setHoverX(e.clientX - rect.left);
  }, [progressRef, duration]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    seekingRef.current = true;
    const rect = progressRef.current?.getBoundingClientRect();
    if (!rect) return;
    const onMove = (ev: MouseEvent) => {
      const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      setCurrentTime(frac * duration);
      seekTo(frac);
    };
    const onUp = () => {
      seekingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [progressRef, duration, seekTo, seekingRef, setCurrentTime]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (v) { if (v.paused) v.play(); else v.pause(); }
  }, [videoRef]);

  const skip = useCallback((sec: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, Math.min(v.duration || Infinity, v.currentTime + sec));
  }, [videoRef]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (v) v.muted = !v.muted;
  }, [videoRef]);

  const changeVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current;
    if (v) v.volume = parseFloat(e.target.value);
  }, [videoRef]);

  const setSpeed = useCallback((rate: number) => {
    const v = videoRef.current;
    if (v) v.playbackRate = rate;
    setShowSpeedMenu(false);
  }, [videoRef, setShowSpeedMenu]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current?.requestFullscreen();
  }, [containerRef]);

  const togglePiP = useCallback(async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (videoRef.current) await videoRef.current.requestPictureInPicture();
    } catch (e) { console.error('PiP error:', e); }
  }, [videoRef]);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (bufferedEnd / duration) * 100 : 0;
  const ctrlLabel: React.CSSProperties = {
    fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: '4px'
  };

  return (
    <div className="sv-controls" onClick={(e) => e.stopPropagation()}>
      <div
        className="sv-progress-container"
        ref={progressRef}
        onClick={handleProgressClick}
        onMouseMove={handleProgressHover}
        onMouseLeave={() => setHoverTime(null)}
        onMouseDown={handleDragStart}
      >
        <div className="sv-progress-bar">
          <div className="sv-progress-buffered" style={{ width: `${bufferedPct}%` }} />
          <div className="sv-progress-played" style={{ width: `${progressPct}%` }} />
          <div className="sv-progress-handle" style={{ left: `${progressPct}%` }} />
        </div>
        {hoverTime !== null && (
          <div className="sv-progress-tooltip" style={{ left: hoverX }}>{formatTime(hoverTime)}</div>
        )}
      </div>

      <div className="sv-controls-bar">
        <button className="sv-ctrl-btn" onClick={togglePlay} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
          {playing ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
        </button>
        <button className="sv-ctrl-btn" onClick={() => skip(-10)} title="Rewind 10s (Left)">
          <Rewind size={18} />
        </button>
        <button className="sv-ctrl-btn" onClick={() => skip(10)} title="Forward 10s (Right)">
          <FastForward size={18} />
        </button>
        <div className="sv-time">
          <span>{formatTime(currentTime)}</span>
          <span className="sv-time-sep">/</span>
          <span>{formatTime(duration)}</span>
        </div>
        <div className="sv-controls-spacer" />

        {/* Volume */}
        <div className="sv-volume-group" onMouseEnter={() => setShowVolumeSlider(true)} onMouseLeave={() => setShowVolumeSlider(false)}>
          <button className="sv-ctrl-btn" onClick={toggleMute} title="Mute (M)">
            {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          {showVolumeSlider && (
            <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={changeVolume} className="sv-volume-slider" />
          )}
        </div>

        {/* Speed */}
        <div className="sv-speed-group">
          <button className="sv-ctrl-btn sv-speed-btn" onClick={() => setShowSpeedMenu(!showSpeedMenu)} title="Playback Speed">
            {playbackRate}x
          </button>
          {showSpeedMenu && (
            <div className="sv-speed-menu">
              {SPEEDS.map(s => (
                <button key={s} className={`sv-speed-option ${s === playbackRate ? 'active' : ''}`} onClick={() => setSpeed(s)}>
                  {s}x
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Subtitles */}
        <div className="sv-subs-group">
          <button
            className="sv-ctrl-btn"
            onClick={() => { setShowSubtitlesMenu(m => !m); setShowStylePanel(false); }}
            title="Subtitles"
          >
            <Subtitles size={18} />
          </button>
          {showSubtitlesMenu && (
            <div className="sv-subs-menu" style={{ minWidth: '220px' }}>
              <div style={{ padding: '8px 8px 4px', display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  value={subQuery}
                  onChange={e => setSubQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchOpenSubtitles(); } }}
                  placeholder="Search subtitles..."
                  style={{
                    flexGrow: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px', color: '#fff', fontSize: '12px', padding: '5px 8px', outline: 'none',
                  }}
                />
                <button
                  onClick={searchOpenSubtitles}
                  disabled={subSearching || !subQuery.trim()}
                  style={{
                    background: 'rgba(0,242,254,0.12)', border: '1px solid rgba(0,242,254,0.25)',
                    borderRadius: '6px', color: 'var(--accent-primary)', padding: '5px 8px',
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                  }}
                >
                  {subSearching ? <Loader2 size={13} className="spinner" /> : <Search size={13} />}
                </button>
              </div>
              {subError && <div style={{ fontSize: '11px', color: 'var(--error)', padding: '0 10px 6px' }}>{subError}</div>}
              {subResults.length > 0 && (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', padding: '4px 10px 2px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    SEARCH RESULTS
                  </div>
                  {subResults.map(sub => (
                    <button key={sub.fileId} className="sv-subs-option" onClick={() => addAndActivateSub(sub)} title={sub.displayName}>
                      {langDisplayName(sub.language)}
                      <span style={{ fontSize: '10px', opacity: 0.5, marginLeft: '4px' }}>OS</span>
                    </button>
                  ))}
                </>
              )}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: '4px' }} />
              <button className="sv-subs-option" onClick={() => { activateTrackByLabel(null); setShowSubtitlesMenu(false); }}>
                Off
              </button>
              {subtitles.map((sub, i) => {
                const label = `${i + 1}. ${langDisplayName(sub.lang)}`;
                return (
                  <button key={sub.id} className="sv-subs-option" onClick={() => { activateTrackByLabel(label); setShowSubtitlesMenu(false); }}>
                    {langDisplayName(sub.lang)}
                  </button>
                );
              })}
              {osSubtitles.length > 0 && (
                <>
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '4px 0', padding: '4px 10px 0', fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em' }}>
                    OPENSUBTITLES
                  </div>
                  {(() => {
                    // Group by language: one release renders as a plain button, several open
                    // into a list so a specific release can be picked.
                    const groups: { lang: string; subs: OSSubOption[] }[] = [];
                    osSubtitles.forEach(sub => {
                      const g = groups.find(x => x.lang === sub.language);
                      if (g) g.subs.push(sub);
                      else groups.push({ lang: sub.language, subs: [sub] });
                    });
                    return groups.map(g => {
                      if (g.subs.length === 1) {
                        const only = g.subs[0];
                        return (
                          <button key={g.lang} className="sv-subs-option" title={only.fileName}
                            onClick={() => { activateTrackByLabel(osTrackLabel(only)); setShowSubtitlesMenu(false); }}>
                            {langDisplayName(g.lang)} <span style={{ fontSize: '10px', opacity: 0.6 }}>OS</span>
                          </button>
                        );
                      }
                      const open = expandedOsLang === g.lang;
                      return (
                        <div key={g.lang}>
                          <button className="sv-subs-option"
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                            onClick={() => setExpandedOsLang(open ? null : g.lang)}>
                            <span>
                              {langDisplayName(g.lang)} <span style={{ fontSize: '10px', opacity: 0.6 }}>OS</span>
                            </span>
                            <span style={{ fontSize: '10px', opacity: 0.7 }}>
                              {g.subs.length} {open ? '▲' : '▼'}
                            </span>
                          </button>
                          {open && g.subs.map(sub => (
                            <button key={sub.fileId} className="sv-subs-option"
                              style={{ paddingLeft: '26px', fontSize: '11.5px', display: 'block', width: '100%', textAlign: 'left' }}
                              title={`${sub.fileName || ''}${sub.downloadCount ? ` · ${sub.downloadCount.toLocaleString()} downloads` : ''}`}
                              onClick={() => { activateTrackByLabel(osTrackLabel(sub)); setShowSubtitlesMenu(false); }}>
                              <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '265px' }}>
                                {(sub.fileName || `Option ${sub.fileId}`).replace(/\.(srt|ass|ssa|vtt|sub)$/i, '')}
                              </span>
                              {sub.downloadCount > 0 && (
                                <span style={{ fontSize: '9.5px', opacity: 0.5 }}>
                                  {sub.downloadCount.toLocaleString()} downloads
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      );
                    });
                  })()}
                </>
              )}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '4px 0' }} />
              <button
                className="sv-subs-option"
                style={{ color: 'var(--accent-primary)', fontWeight: 600, fontSize: '12px' }}
                onClick={() => setShowStylePanel(p => !p)}
              >
                {showStylePanel ? '▲' : '▼'} Subtitle Style
              </button>
              {showStylePanel && (
                <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <div style={ctrlLabel}>Size</div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {(['sm', 'md', 'lg', 'xl'] as const).map(s => (
                        <button
                          key={s}
                          onClick={() => setSubtitleStyle({ ...subtitleStyle, size: s })}
                          style={{
                            flex: 1, padding: '4px 0', borderRadius: '4px', border: 'none', cursor: 'pointer',
                            fontSize: s === 'sm' ? '10px' : s === 'md' ? '12px' : s === 'lg' ? '14px' : '16px',
                            background: subtitleStyle.size === s ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
                            color: subtitleStyle.size === s ? '#07070a' : 'var(--text-secondary)', fontWeight: 600,
                          }}
                        >Aa</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={ctrlLabel}>Color</div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {COLOR_PRESETS.map(c => (
                        <button
                          key={c.value}
                          title={c.label}
                          onClick={() => setSubtitleStyle({ ...subtitleStyle, color: c.value })}
                          style={{
                            width: '20px', height: '20px', borderRadius: '50%', padding: 0, flexShrink: 0,
                            border: subtitleStyle.color === c.value ? '2px solid var(--accent-primary)' : '2px solid rgba(255,255,255,0.15)',
                            background: c.value, cursor: 'pointer',
                          }}
                        />
                      ))}
                      <input
                        type="color"
                        value={subtitleStyle.color}
                        onChange={e => setSubtitleStyle({ ...subtitleStyle, color: e.target.value })}
                        style={{ width: '20px', height: '20px', border: 'none', background: 'none', cursor: 'pointer', padding: 0 }}
                        title="Custom color"
                      />
                    </div>
                  </div>
                  <div>
                    <div style={ctrlLabel}>Background {Math.round(subtitleStyle.bgOpacity * 100)}%</div>
                    <input
                      type="range" min={0} max={0.9} step={0.05} value={subtitleStyle.bgOpacity}
                      onChange={e => setSubtitleStyle({ ...subtitleStyle, bgOpacity: parseFloat(e.target.value) })}
                      style={{ width: '100%', accentColor: 'var(--accent-primary)' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {([['bold', 'Bold'], ['shadow', 'Shadow']] as const).map(([key, lbl]) => (
                      <button
                        key={key}
                        onClick={() => setSubtitleStyle({ ...subtitleStyle, [key]: !subtitleStyle[key] })}
                        style={{
                          flex: 1, padding: '5px 0', borderRadius: '4px', border: 'none', cursor: 'pointer',
                          fontSize: '12px', fontWeight: key === 'bold' ? 700 : 400,
                          background: subtitleStyle[key] ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
                          color: subtitleStyle[key] ? '#07070a' : 'var(--text-secondary)',
                        }}
                      >{lbl}</button>
                    ))}
                  </div>
                  <button
                    onClick={() => setSubtitleStyle(DEFAULT_SS)}
                    style={{ fontSize: '11px', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                  >
                    Reset to defaults
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {'pictureInPictureEnabled' in document && (
          <button className="sv-ctrl-btn" onClick={togglePiP} title="Picture-in-Picture">
            <PictureInPicture2 size={18} color={isPiP ? 'var(--accent-primary)' : 'currentColor'} />
          </button>
        )}
        <button className="sv-ctrl-btn" onClick={toggleFullscreen} title="Fullscreen (F)">
          {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
        <button className="sv-ctrl-btn" onClick={onToggleHelp} title="Keyboard shortcuts (?)" style={{ fontSize: '14px', fontWeight: 700, width: '32px' }}>
          ?
        </button>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  playerContainer: {
    position: 'fixed',
    top: 0, left: 0,
    width: '100vw', height: '100vh',
    background: '#000000',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ffffff',
  },
  iframe: {
    position: 'absolute',
    top: 0, left: 0,
    width: '100%', height: '100%',
    border: 'none',
    zIndex: 1,
    transition: 'opacity 0.3s ease',
  },
  backdrop: {
    position: 'absolute',
    top: 0, left: 0,
    width: '100%', height: '100%',
    overflow: 'hidden',
    zIndex: 0,
    pointerEvents: 'none',
  },
  videoWrapper: {
    position: 'absolute',
    top: 0, left: 0,
    width: '100%', height: '100%',
  },
  videoEl: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
    background: '#000',
  },
  overlay: {
    position: 'absolute',
    top: 0, left: 0,
    width: '100%', height: '100%',
    background: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '20px',
    zIndex: 10,
    padding: '20px',
  },
  bufferingIndicator: {
    position: 'absolute',
    top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    zIndex: 5,
    pointerEvents: 'none',
    opacity: 0.85,
  },
  errorBox: {
    maxWidth: '480px', width: '100%',
    background: 'rgba(20, 10, 10, 0.65)',
    border: '1px solid rgba(255, 77, 77, 0.25)',
    borderRadius: '16px',
    padding: '32px',
    textAlign: 'center',
    backdropFilter: 'blur(16px)',
  },
  resumeToast: {
    position: 'absolute',
    bottom: '120px', left: '32px',
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '10px 14px', borderRadius: '10px',
    fontSize: '13px', zIndex: 25,
  },
  resumeToastBtn: {
    background: 'rgba(0, 242, 254, 0.1)',
    border: '1px solid rgba(0, 242, 254, 0.3)',
    color: 'var(--accent-primary)',
    borderRadius: '6px', padding: '4px 10px',
    fontSize: '12px', fontWeight: 600, cursor: 'pointer',
  },
  resumeToastClose: {
    background: 'none', border: 'none',
    color: 'var(--text-muted)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', padding: '2px',
  },
  topBar: {
    position: 'absolute',
    top: 0, left: 0, width: '100%',
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.4) 60%, rgba(0,0,0,0) 100%)',
    padding: '24px 32px',
    display: 'flex', alignItems: 'center', gap: '24px',
    zIndex: 20,
  },
  backButton: {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '50%',
    width: '44px', height: '44px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', color: '#ffffff', outline: 'none',
    transition: 'var(--transition-smooth)', flexShrink: 0,
  },
  titleInfo: {
    flexGrow: 1,
    display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0,
  },
  nowPlaying: {
    fontSize: '10px', letterSpacing: '0.15em',
    color: 'var(--accent-primary)', fontWeight: '700',
  },
  videoTitle: {
    fontSize: '18px', fontWeight: '600',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '50vw',
  },
  topActions: {
    display: 'flex', gap: '12px', flexShrink: 0,
  },
  actionButton: {
    padding: '8px 16px', fontSize: '13px', borderRadius: '8px', textDecoration: 'none',
  },
  nextEpisodeOverlay: {
    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
    background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 15, backdropFilter: 'blur(6px)',
  },
  nextEpisodeBox: {
    background: 'rgba(18,18,28,0.95)', border: '1px solid rgba(0,242,254,0.3)',
    borderRadius: '16px', padding: '40px', textAlign: 'center', maxWidth: '480px',
  },
  nextEpisodeTitle: { fontSize: '24px', fontWeight: 700, marginBottom: '12px' },
  nextEpisodeFilename: { fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', wordBreak: 'break-word' },
  nextEpisodeButtons: { display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '16px' },
  nextEpisodeBtn: { padding: '10px 20px', fontSize: '14px', borderRadius: '8px', minWidth: '120px' },
  nextEpisodeCountdown: { fontSize: '12px', color: 'var(--text-muted)' },
  helpOverlay: {
    position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
    background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 30, backdropFilter: 'blur(4px)',
  },
  helpBox: {
    background: 'rgba(18,18,28,0.97)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '16px', padding: '28px 32px', minWidth: '300px',
  },
  helpHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  helpTitle: {
    fontSize: '12px', fontWeight: '700', color: 'var(--accent-primary)',
    letterSpacing: '0.1em', textTransform: 'uppercase',
  },
  helpClose: {
    background: 'none', border: 'none', color: 'var(--text-muted)',
    cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px',
  },
  helpGrid: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '14px 24px', alignItems: 'center' },
  helpKey: {
    fontFamily: 'monospace', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)',
    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px', padding: '4px 10px', whiteSpace: 'nowrap', textAlign: 'center',
  },
  helpDesc: { fontSize: '14px', color: 'var(--text-secondary)' },
};