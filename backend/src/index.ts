import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import cors from 'cors';
import path from 'path';
import http from 'http';
import jwt from 'jsonwebtoken';
import { config } from './env';
import {
  RateLimiter,
  assertPublicHttpUrl,
  clientIp,
  createGuardedAgents,
  extractToken,
  hostOf,
  log,
  safeEqual,
  securityHeaders,
  sendError,
} from './http';
import { spawn, execSync } from 'child_process';
import { mkdirSync, readdirSync, statSync, unlinkSync, rmdirSync, writeFileSync, readFileSync, existsSync, createReadStream, realpathSync as fsRealpath } from 'fs';
// Prefer system ffmpeg/ffprobe if available, fall back to npm binaries
let ffmpegPath = 'ffmpeg';
let ffprobePath = 'ffprobe';
try {
  const sysFfmpeg = execSync('which ffmpeg', { encoding: 'utf8' }).trim();
  if (sysFfmpeg) ffmpegPath = sysFfmpeg;
} catch {
  try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; } catch { /* keep default */ }
}
try {
  const sysFfprobe = execSync('which ffprobe', { encoding: 'utf8' }).trim();
  if (sysFfprobe) ffprobePath = sysFfprobe;
} catch {
  try { ffprobePath = require('@ffprobe-installer/ffprobe').path; } catch { /* keep default */ }
}
import { listTorrents, getDownloadLink, searchTorrents, addTorrentByMagnet, TorBoxTorrent, TorBoxFile } from './services/torbox';
import { mapTorrents, updateMapping, getMappedTorrent } from './services/mapping';
import {
  searchMovie,
  searchTV,
  getMovieDetails,
  getTVSeason,
  getTVDetails,
  getCredits,
  getVideos,
  getTrending,
  getPopular,
  getGenres,
  getMoviesByGenre
} from './services/tmdb';
import { fetchAndConvertSubtitle, getSubtitleFiles, convertSrtToVtt, SubtitleCandidate } from './utils/subtitles';
import { searchSubtitles as osSearch, getSubtitleDownloadUrl } from './services/opensubtitles';
import { detectBadges } from './services/badges';
import { handleScrape } from './services/scraper';
import { listScrapers } from './services/scrapers';

// Configuration is loaded and validated in ./env (dotenv runs there). An incomplete
// environment now fails loudly at startup instead of silently using placeholder secrets.
const app = express();
const PORT = config.PORT;

app.disable('x-powered-by');
app.set('trust proxy', config.TRUST_PROXY);
app.use(securityHeaders);
app.use(cors({
  origin: config.corsOrigin,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '256kb' }));

// Liveness probe, deliberately unauthenticated and dependency-free.
app.get('/healthz', (_req: Request, res: Response) => {
  res.json({ ok: true, env: config.env, uptime: Math.round(process.uptime()) });
});

// Extend Request interface to include user
interface AuthRequest extends Request {
  user?: any;
}

// Authentication middleware. Auth is disabled only when configuration says so
// (APP_PASSWORD unset or 'none'); ./env refuses that combination in production unless
// ALLOW_NO_AUTH is set on purpose.
const loginLimiter = new RateLimiter(10, 15 * 60 * 1000);

function verifyJwt(token: string): boolean {
  try {
    jwt.verify(token, config.JWT_SECRET);
    return true;
  } catch {
    return false;
  }
}

const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (config.authDisabled) return next();

  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ success: false, detail: 'Access denied. Authorization token missing.' });
  }
  if (!verifyJwt(token)) {
    return res.status(401).json({ success: false, detail: 'Access denied. Invalid or expired token.' });
  }
  next();
};

// --- ffmpeg child tracking --------------------------------------------------
// Children used to be spawned freely and only killed when the client disconnected, so a
// few abandoned requests could pile up encoder processes. Track them so shutdown can
// reap them and so we can refuse work past a configured ceiling.
const ffmpegChildren = new Set<import('child_process').ChildProcess>();

/**
 * Split accounting: direct streams (/api/ffstream) and HLS background encoders are counted
 * separately. Sharing one counter meant a single HLS playback with four audio tracks ate
 * four slots and every direct stream returned 503 for minutes.
 */
const directStreams = new Set<import('child_process').ChildProcess>();
const hlsChildren = new Set<import('child_process').ChildProcess>();

/**
 * Cache keys with encoders already running, so a second viewer of the same title waits for
 * the first transcode instead of starting a duplicate set into the same directory.
 */
const hlsInFlight = new Set<string>();

function trackChild(child: import('child_process').ChildProcess, kind: 'direct' | 'hls' = 'direct'): void {
  ffmpegChildren.add(child);
  const bucket = kind === 'hls' ? hlsChildren : directStreams;
  bucket.add(child);
  const drop = () => {
    ffmpegChildren.delete(child);
    bucket.delete(child);
  };
  child.on('exit', drop);
  child.on('error', drop);
}

// --- Subtitle <-> video matching helpers ---

const baseName = (p: string) => p.split('/').pop() || p;
const stripExt = (p: string) => p.replace(/\.[^/.]+$/, '');

/** Extracts a season/episode tag from a filename: S01E05, 1x05, or anime " - 05". */
function parseEpisodeTag(filename: string): { season?: number; episode: number } | null {
  const name = baseName(filename);
  const sxe = name.match(/[sS](\d{1,2})\s*[._ ]?[eE](\d{1,3})/);
  if (sxe) return { season: parseInt(sxe[1], 10), episode: parseInt(sxe[2], 10) };
  const nxn = name.match(/\b(\d{1,2})[xX](\d{2,3})\b/);
  if (nxn) return { season: parseInt(nxn[1], 10), episode: parseInt(nxn[2], 10) };
  const anime = name.match(/\s-\s(\d{1,3})(?:v\d)?(?=[\s.[(]|$)/);
  if (anime) return { episode: parseInt(anime[1], 10) };
  return null;
}

/**
 * Matches subtitles to a specific video file. Compares basenames (subs often live in a
 * "Subs/" subfolder, so full paths never match) and falls back to episode-tag matching.
 * When the torrent has a single video file, every subtitle belongs to it.
 */
function findMatchingSubtitles(videoFile: TorBoxFile, allSubtitles: SubtitleCandidate[], videoFileCount: number): SubtitleCandidate[] {
  if (allSubtitles.length === 0) return [];
  if (videoFileCount === 1) return allSubtitles;

  const vidBase = stripExt(baseName(videoFile.name)).toLowerCase();
  const vidEp = parseEpisodeTag(videoFile.name);

  const matched = allSubtitles.filter(sub => {
    const subBase = stripExt(baseName(sub.name)).toLowerCase();
    // "Movie.2024.en.srt" includes "Movie.2024", or sub folder named after the episode
    if (subBase.includes(vidBase) || (subBase.length > 8 && vidBase.includes(subBase))) {
      return true;
    }
    const subEp = parseEpisodeTag(sub.name);
    if (vidEp && subEp && vidEp.episode === subEp.episode) {
      // Match unless both declare a season and they differ
      return vidEp.season === undefined || subEp.season === undefined || vidEp.season === subEp.season;
    }
    return false;
  });

  // Last resort: a lone subtitle in a multi-video torrent is better offered than hidden
  if (matched.length === 0 && allSubtitles.length === 1) return allSubtitles;
  return matched;
}

// Check if a file is a video
function isVideoFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase();
  const videoExtensions = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'flv'];
  return !!ext && videoExtensions.includes(ext);
}

// --- API ROUTES ---

// 1. Authentication
app.post('/api/auth/login', (req: Request, res: Response) => {
  // Brute-force protection: fixed window per caller.
  const { limited, retryAfterSeconds } = loginLimiter.check(clientIp(req));
  if (limited) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({ success: false, detail: 'Too many attempts. Try again later.' });
  }

  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  // Auth disabled by configuration: still return a token so the client flow is unchanged.
  if (config.authDisabled) {
    const token = jwt.sign({ authenticated: true }, config.JWT_SECRET, { expiresIn: '30d' });
    return res.json({ success: true, token });
  }

  // Timing-safe comparison; there is deliberately no fallback password.
  const ok = password.length > 0 && safeEqual(password, config.APP_PASSWORD);
  if (!ok) {
    log('warn', 'Failed login attempt', { ip: clientIp(req) });
    return res.status(400).json({ success: false, detail: 'Incorrect password.' });
  }

  loginLimiter.reset(clientIp(req));
  const token = jwt.sign({ authenticated: true }, config.JWT_SECRET, { expiresIn: '30d' }); // 30 days session
  return res.json({ success: true, token });
});

// Check auth status
app.get('/api/auth/status', authMiddleware, (req: AuthRequest, res: Response) => {
  return res.json({ success: true, authenticated: true });
});

// 2. TorBox + TMDb Library Grid
app.get('/api/torrents', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const rawTorrents = await listTorrents();
    
    // Map with TMDb metadata
    const mapped = await mapTorrents(rawTorrents);
    
    // Process each torrent to filter video files and map their matched subtitles
    const processed = mapped.map(torrent => {
      const allSubs = getSubtitleFiles(torrent.files || []);

      const videoSources = (torrent.files || []).filter(f => isVideoFile(f.name));
      const videos = videoSources.map(video => ({
        id: video.id,
        name: video.name,
        size: video.size,
        subtitles: findMatchingSubtitles(video, allSubs, videoSources.length)
      }));

      return {
        id: torrent.id,
        torrentId: torrent.id, // separate field for source-switching frontend
        name: torrent.name,
        hash: torrent.hash,
        size: torrent.size,
        progress: torrent.progress,
        status: torrent.status,
        download_finished: torrent.download_finished,
        ready: torrent.ready,
        // Watchable = parser thinks it's a film/show AND it has (or may still get) video files
        isMedia: torrent.metadata?.isMedia !== false && (videos.length > 0 || !torrent.ready),
        metadata: torrent.metadata,
        videoFiles: videos,
        allSubtitleFiles: allSubs,
        badges: detectBadges(torrent.name)
      };
    });

    // Consolidate duplicates: group torrents that map to the same TMDb ID
    // into a single card with a "sources" list so the user can pick which
    // torrent to stream from.
    const grouped = new Map<number | string, typeof processed>();
    const noTmdb: typeof processed = [];

    for (const t of processed) {
      // Consolidate by TMDb id AND type: a movie and a TV show can share the
      // same numeric id (e.g. Black Gunn and The Last of Us are both 100088).
      const key = t.metadata?.tmdbId != null ? `${t.metadata.type ?? 'other'}:${t.metadata.tmdbId}` : null;
      if (key == null) {
        noTmdb.push(t);
      } else {
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(t);
      }
    }

    const consolidated = noTmdb.map(t => ({ ...t, sources: [t] }));

    for (const [, sources] of grouped) {
      // Default source: prefer ready, then highest progress, then newest (largest TorBox id)
      const defaultSrc = [...sources].sort((a, b) => {
        if (a.ready !== b.ready) return a.ready ? -1 : 1;
        if (a.progress !== b.progress) return b.progress - a.progress;
        return b.id - a.id;
      })[0];

      consolidated.push({
        ...defaultSrc,
        sources: sources.map(s => ({
          ...s,
          // Remove circular reference: sources don't need their own sources array
        }))
      });
    }

    // Sort consolidated: media first, then other, both by newest id
    consolidated.sort((a, b) => {
      if (a.isMedia !== b.isMedia) return a.isMedia ? -1 : 1;
      return (b.metadata?.lastUpdated ?? 0) - (a.metadata?.lastUpdated ?? 0);
    });

    return res.json({ success: true, data: consolidated });
  } catch (error: any) {
    return sendError(res, 500, 'Failed to fetch library.', error);
  }
});

// 3. Manual override mapping
app.post('/api/torrents/map-manually', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { hashes, hash, tmdbId, type } = req.body;
  // Accept single hash (legacy) or hashes array (consolidated cards)
  const hashList: string[] = hashes || (hash ? [hash] : []);
  const VALID_TYPES = ['movie', 'tv', 'other'];
  if (!hashList.length || !tmdbId || !type) {
    return res.status(400).json({ success: false, detail: 'Missing hashes, tmdbId, or type.' });
  }
  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ success: false, detail: `Invalid type "${type}". Must be movie, tv, or other.` });
  }
  const parsedTmdbId = parseInt(String(tmdbId), 10);
  if (type !== 'other' && (!Number.isFinite(parsedTmdbId) || parsedTmdbId <= 0)) {
    return res.status(400).json({ success: false, detail: 'Invalid tmdbId. Must be a positive integer.' });
  }

  try {
    const results = [];
    for (const h of hashList) {
      const updated = await updateMapping(h, parsedTmdbId, type);
      results.push(updated);
    }
    return res.json({ success: true, data: results });
  } catch (error: any) {
    return sendError(res, 500, 'Failed to update mapping.', error);
  }
});

// 4. Request download/stream link
app.get('/api/stream/:torrentId/:fileId', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { torrentId, fileId } = req.params;
  try {
    const cdnUrl = await getDownloadLink(torrentId, fileId);
    return res.json({ success: true, streamUrl: cdnUrl });
  } catch (error: any) {
    return sendError(res, 500, 'Failed to get stream URL.', error);
  }
});

// 5. Convert and stream subtitle (SRT to VTT)
app.get('/api/subtitles/:torrentId/:fileId', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { torrentId, fileId } = req.params;
  const rawName = req.query.name;
  const nameVal = Array.isArray(rawName) ? rawName[0] : rawName;
  const filename = typeof nameVal === 'string' ? nameVal : 'subtitle.srt';
  
  try {
    const vttContent = await fetchAndConvertSubtitle(torrentId, fileId, filename);
    
    // Set headers to serve it as WebVTT format
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send(vttContent);
  } catch (error: any) {
    console.error('Subtitle fetching/conversion error:', error);
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    // Return empty WEBVTT so the player doesn't break
    return res.send('WEBVTT\n\n');
  }
});

// 6. TMDb Search Proxy
app.get('/api/tmdb/search', authMiddleware, async (req: AuthRequest, res: Response) => {
  const query = req.query.query as string;
  const rawType = typeof req.query.type === 'string' ? req.query.type : '';
  const type: 'movie' | 'tv' = rawType === 'tv' ? 'tv' : 'movie';
  const year = typeof req.query.year === 'string' ? req.query.year : undefined;
  const page = parseInt(req.query.page as string, 10) || 1;

  if (!query) {
    return res.status(400).json({ success: false, detail: 'Query parameter is required.' });
  }

  try {
    let results = [];
    if (type === 'movie') {
      results = await searchMovie(query, year, page);
    } else {
      results = await searchTV(query, year, page);
    }
    return res.json({ success: true, data: results });
  } catch (error: any) {
    return sendError(res, 500, 'TMDb search failed.', error);
  }
});

// 6b. Movie details
app.get('/api/tmdb/movie/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ success: false, detail: 'Invalid movie ID.' });
  }
  try {
    const data = await getMovieDetails(id);
    if (!data) return res.status(404).json({ success: false, detail: 'Movie not found.' });
    return res.json({ success: true, data });
  } catch (error: any) {
    return sendError(res, 500, 'Failed to fetch movie details.', error);
  }
});

// 6c. Trending movies/TV
app.get('/api/tmdb/trending', authMiddleware, async (req: AuthRequest, res: Response) => {
  const rawType = req.query.type as string;
  const type: 'movie' | 'tv' = rawType === 'tv' ? 'tv' : 'movie';
  const page = parseInt(req.query.page as string, 10) || 1;
  try {
    const data = await getTrending(type, page);
    return res.json({ success: true, data });
  } catch (error: any) {
    return sendError(res, 500, 'Failed to fetch trending.', error);
  }
});

// 6d. Popular movies/TV
app.get('/api/tmdb/popular', authMiddleware, async (req: AuthRequest, res: Response) => {
  const rawType = req.query.type as string;
  const type: 'movie' | 'tv' = rawType === 'tv' ? 'tv' : 'movie';
  const page = parseInt(req.query.page as string, 10) || 1;
  try {
    const data = await getPopular(type, page);
    return res.json({ success: true, data });
  } catch (error: any) {
    return sendError(res, 500, 'Failed to fetch popular.', error);
  }
});

// 6e. Genre lists (movie + TV)
app.get('/api/tmdb/genres', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const data = await getGenres();
    return res.json({ success: true, data });
  } catch (error: any) {
    return sendError(res, 500, 'Failed to fetch genres.', error);
  }
});

// 6f. Movies by genre
app.get('/api/tmdb/genre/:genreId/movies', authMiddleware, async (req: AuthRequest, res: Response) => {
  const genreId = parseInt(req.params.genreId, 10);
  if (isNaN(genreId)) {
    return res.status(400).json({ success: false, detail: 'Invalid genre ID.' });
  }
  const page = parseInt(req.query.page as string, 10) || 1;
  try {
    const data = await getMoviesByGenre(genreId, page);
    return res.json({ success: true, data });
  } catch (error: any) {
    return sendError(res, 500, 'Failed to fetch genre movies.', error);
  }
});

// 7a. TV Show details (number_of_seasons)
app.get('/api/tmdb/tv/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ success: false, detail: 'Invalid show ID.' });
  }
  try {
    const data = await getTVDetails(id);
    if (!data) return res.status(404).json({ success: false, detail: 'TV show not found.' });
    return res.json({ success: true, data });
  } catch (error: any) {
    return sendError(res, 500, 'Failed to fetch TV details.', error);
  }
});

// 7a2. TV Show details (full) — alias consumed by the discovery frontend data layer
app.get('/api/tmdb/tv/:id/full', authMiddleware, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ success: false, detail: 'Invalid show ID.' });
  }
  try {
    const data = await getTVDetails(id);
    if (!data) return res.status(404).json({ success: false, detail: 'TV show not found.' });
    return res.json({ success: true, data });
  } catch (error: any) {
    return sendError(res, 500, 'Failed to fetch TV details.', error);
  }
});

// 7b. TV Series Season/Episodes fetch
app.get('/api/tmdb/tv/:id/season/:season', authMiddleware, async (req: AuthRequest, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const season = parseInt(req.params.season, 10);

  if (isNaN(id) || isNaN(season)) {
    return res.status(400).json({ success: false, detail: 'Invalid show ID or season number.' });
  }

  try {
    const seasonData = await getTVSeason(id, season);
    if (seasonData) {
      return res.json({ success: true, data: seasonData });
    }
    return res.status(404).json({ success: false, detail: 'Season not found.' });
  } catch (error: any) {
    return sendError(res, 500, 'Failed to fetch season details.', error);
  }
});

// 8. Cast credits
app.get('/api/tmdb/credits/:type/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { type, id } = req.params;
  const tmdbId = parseInt(id, 10);
  if (!['movie', 'tv'].includes(type) || isNaN(tmdbId)) {
    return res.status(400).json({ success: false, detail: 'Invalid type or id.' });
  }
  try {
    const data = await getCredits(type as 'movie' | 'tv', tmdbId);
    if (data) return res.json({ success: true, data });
    return res.status(404).json({ success: false, detail: 'Credits not found.' });
  } catch (error: any) {
    return sendError(res, 500, 'Request failed.', error);
  }
});

// 9. Trailer (YouTube key)
app.get('/api/tmdb/trailer/:type/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { type, id } = req.params;
  const tmdbId = parseInt(id, 10);
  if (!['movie', 'tv'].includes(type) || isNaN(tmdbId)) {
    return res.status(400).json({ success: false, detail: 'Invalid type or id.' });
  }
  try {
    const data = await getVideos(type as 'movie' | 'tv', tmdbId);
    if (!data) return res.status(404).json({ success: false, detail: 'No videos found.' });
    const results: any[] = data.results || [];
    const trailer =
      results.find(v => v.type === 'Trailer' && v.site === 'YouTube' && v.official) ||
      results.find(v => v.type === 'Trailer' && v.site === 'YouTube') ||
      results.find(v => v.site === 'YouTube');
    if (!trailer) return res.status(404).json({ success: false, detail: 'No trailer available.' });
    return res.json({ success: true, data: { key: trailer.key, name: trailer.name } });
  } catch (error: any) {
    return sendError(res, 500, 'Request failed.', error);
  }
});

// 10. OpenSubtitles — search by TMDb ID or free-text query
app.get('/api/opensubs/search', authMiddleware, async (req: AuthRequest, res: Response) => {
  const tmdbId = parseInt(req.query.tmdbId as string, 10);
  const rawType = req.query.type as string;
  const type: 'movie' | 'tv' = rawType === 'tv' ? 'tv' : 'movie';
  const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
  // TV needs these: OpenSubtitles matches nothing for a bare tmdb_id+type=tv.
  const season = parseInt(req.query.season as string, 10);
  const episode = parseInt(req.query.episode as string, 10);

  if (!query && (!tmdbId || isNaN(tmdbId))) {
    return res.status(400).json({ success: false, detail: 'Provide tmdbId or query.' });
  }
  try {
    const results = await osSearch({
      tmdbId: isNaN(tmdbId) ? undefined : tmdbId,
      type,
      query: query || undefined,
      season: isNaN(season) ? undefined : season,
      episode: isNaN(episode) ? undefined : episode,
    });
    return res.json({ success: true, data: results });
  } catch (error: any) {
    console.error('[OpenSubtitles] search error:', error.message);
    return sendError(res, 500, 'OpenSubtitles search failed.', error);
  }
});

// 11. OpenSubtitles — proxy download and serve as WebVTT
app.get('/api/opensubs/:fileId', authMiddleware, async (req: AuthRequest, res: Response) => {
  const fileId = parseInt(req.params.fileId, 10);
  if (isNaN(fileId)) {
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    return res.send('WEBVTT\n\n');
  }
  try {
    const downloadUrl = await getSubtitleDownloadUrl(fileId);
    const fileResp = await axios.get(downloadUrl, {
      responseType: 'text',
      timeout: 15000,
      maxContentLength: 5 * 1024 * 1024,
      maxBodyLength: 5 * 1024 * 1024
    });
    const content = fileResp.data as string;
    const filename = downloadUrl.split('?')[0].split('/').pop() || 'subtitle.srt';
    const ext = filename.split('.').pop()?.toLowerCase();
    let vtt: string;
    if (ext === 'vtt' || content.trimStart().startsWith('WEBVTT')) {
      vtt = content.replace(/^\uFEFF/, '');
    } else {
      vtt = convertSrtToVtt(content);
    }
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send(vtt);
  } catch (error: any) {
    console.error('[OpenSubtitles] download error:', error.message);
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send('WEBVTT\n\n');
  }
});

// 12. TorBox torrent search
app.get('/api/torbox/search', authMiddleware, async (req: AuthRequest, res: Response) => {
  const query = req.query.query as string;
  if (!query || query.trim().length < 2) {
    return res.status(400).json({ success: false, detail: 'Query must be at least 2 characters.' });
  }
  try {
    const results = await searchTorrents(query.trim());
    return res.json({ success: true, data: results });
  } catch (error: any) {
    return sendError(res, 500, 'TorBox search failed.', error);
  }
});

// 11. Add torrent to TorBox via magnet link
app.post('/api/torbox/add', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { magnet } = req.body;
  if (!magnet || typeof magnet !== 'string' || !magnet.startsWith('magnet:')) {
    return res.status(400).json({ success: false, detail: 'A valid magnet link is required.' });
  }
  try {
    const result = await addTorrentByMagnet(magnet);
    return res.json({ success: true, data: result });
  } catch (error: any) {
    return sendError(res, 500, 'Failed to add torrent.', error);
  }
});

// 11b. Multi-source scrape (Server-Sent Events)
app.post('/api/scrape', authMiddleware, (req: Request, res: Response) => {
  void handleScrape(req, res);
});

// 12b. Scrape status — which sources are enabled (debugging / UI hints)
app.get('/api/scrape/status', authMiddleware, (req: Request, res: Response) => {
  return res.json({ success: true, data: listScrapers() });
});

// --- FFmpeg helpers ---

interface AudioTrack {
  index: number;
  codec: string;
  language: string;
  title: string;
  channels: number;
}

function probeAudioTracks(url: string): Promise<AudioTrack[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath, [
      '-v', 'quiet',
      '-probesize', '5000000',
      '-analyzeduration', '5000000',
      '-print_format', 'json',
      '-show_streams',
      '-select_streams', 'a',
      url,
    ]);

    let stdout = '';
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', () => {});
    proc.on('error', (err) => { clearTimeout(timeout); reject(err); });

    const timeout = setTimeout(() => { proc.kill(); reject(new Error('ffprobe timed out')); }, 30000);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error('ffprobe exited with code ' + code));
      try {
        const data = JSON.parse(stdout);
        const tracks: AudioTrack[] = (data.streams || []).map((s: any, i: number) => ({
          index: i,
          codec: s.codec_name || '',
          language: s.tags?.language || '',
          title: s.tags?.title || '',
          channels: s.channels || 2,
        }));
        resolve(tracks);
      } catch (e) {
        reject(e);
      }
    });
  });
}

// 13. Probe audio tracks for a torrent file
app.get('/api/probe/:torrentId/:fileId', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { torrentId, fileId } = req.params;
  try {
    const cdnUrl = await getDownloadLink(torrentId, fileId);
    const tracks = await probeAudioTracks(cdnUrl);
    return res.json({ success: true, tracks });
  } catch (error: any) {
    return sendError(res, 500, 'ffprobe failed.', error);
  }
});

// 14. Stream a file through FFmpeg with a selected audio track
// Auth via ?t=<jwt> query param so the URL can be set as a video src directly.
app.get('/api/ffstream/:torrentId/:fileId', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { torrentId, fileId } = req.params;
  const track = Math.max(0, parseInt(req.query.track as string || '0', 10));
  const seek = Math.max(0, parseInt(req.query.seek as string || '0', 10));

  try {
    const cdnUrl = await getDownloadLink(torrentId, fileId);

    // Admission control BEFORE any header is written: the previous placement answered 503
    // after setting video/mp4 + chunked encoding, so the client received a JSON body under
    // video headers.
    if (directStreams.size >= config.MAX_FFMPEG_PROCS) {
      return sendError(res, 503, 'Too many concurrent streams right now. Try again shortly.');
    }

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');

    const args = [
      '-hide_banner', '-loglevel', 'error',
    ];
    if (seek > 0) {
      args.push('-ss', String(seek));
    }
    args.push(
      '-i', cdnUrl,
      '-map', '0:v:0',
      '-map', `0:a:${track}`,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      'pipe:1',
    );

    const ff = spawn(ffmpegPath, args);
    trackChild(ff, 'direct');

    ff.stdout.pipe(res);
    ff.stderr.on('data', () => {});

    ff.on('error', (err) => {
      console.error('[FFmpeg] spawn error:', err.message);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });

    req.on('close', () => ff.kill('SIGTERM'));
  } catch (error: any) {
    return sendError(res, 500, 'FFmpeg stream failed.', error);
  }
});

// --- HLS Routes ---

const HLS_CACHE_DIR = process.env.HLS_CACHE_DIR || '/tmp/sv-cache';
mkdirSync(HLS_CACHE_DIR, { recursive: true });
const HLS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Track last access time for cache cleanup
const cacheAccess: Map<string, number> = new Map();

// Clean up expired caches every hour
const hlsCacheSweeper = setInterval(() => {
  const now = Date.now();
  try {
    for (const entry of readdirSync(HLS_CACHE_DIR)) {
      const cacheKey = entry;
      const lastAccess = cacheAccess.get(cacheKey) || 0;
      if (now - lastAccess > HLS_TTL_MS) {
        const dir = path.join(HLS_CACHE_DIR, entry);
        try {
          for (const f of readdirSync(dir)) {
            const subPath = path.join(dir, f);
            const stat = statSync(subPath);
            if (stat.isDirectory()) {
              for (const sf of readdirSync(subPath)) unlinkSync(path.join(subPath, sf));
              rmdirSync(subPath);
            } else {
              unlinkSync(subPath);
            }
          }
          rmdirSync(dir);
          cacheAccess.delete(cacheKey);
          console.log(`[HLS] Cleaned up expired cache: ${cacheKey}`);
        } catch { /* ignore */ }
      }
    }
  } catch { /* cache dir might not exist yet */ }
}, 60 * 60 * 1000);

/** TorBox ids are numeric; anything else must never reach a filesystem path. */
const TORBOX_ID_RE = /^\d{1,15}$/;

/**
 * Cache directory for a (torrentId, fileId) pair, or null if the ids are unusable.
 *
 * Express decodes %2F inside a single path segment, so `fileId` could contain slashes and
 * `..`: `GET /api/hls/1/%2F..%2F..%2F..%2Fetc/passwd` produced the cache dir `/etc` and the
 * route then served /etc/passwd (verified against a running server; the old
 * `subPath.includes('..')` check only ever inspected the wildcard remainder). The resolved
 * path is therefore also asserted to stay inside HLS_CACHE_DIR.
 */
function hlsCacheDir(torrentId: string, fileId: string): string | null {
  if (!TORBOX_ID_RE.test(torrentId) || !TORBOX_ID_RE.test(fileId)) return null;
  const root = path.resolve(HLS_CACHE_DIR);
  const dir = path.resolve(root, `${torrentId}_${fileId}`);
  if (dir !== root && !dir.startsWith(root + path.sep)) return null;
  return dir;
}

// Serve master playlist — triggers on-demand HLS segmentation if needed
app.get('/api/hls/:torrentId/:fileId/master.m3u8', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { torrentId, fileId } = req.params;
  const cacheDir = hlsCacheDir(torrentId, fileId);
  if (!cacheDir) {
    log('warn', 'Rejected HLS request with invalid ids', { torrentId, fileId, ip: clientIp(req) });
    return res.status(400).json({ success: false, detail: 'Invalid id.' });
  }
  const cacheKey = `${torrentId}_${fileId}`;
  const masterPath = path.join(cacheDir, 'master.m3u8');

  try {
    // If already cached, return immediately
    if (statSync(masterPath).isFile()) {
      cacheAccess.set(`${torrentId}_${fileId}`, Date.now());
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.sendFile(masterPath);
    }
  } catch { /* not cached yet, proceed */ }

  try {
    mkdirSync(cacheDir, { recursive: true });
    for (let i = 0; i < 10; i++) {
      mkdirSync(path.join(cacheDir, `audio_${i}`), { recursive: true });
    }

    // Probe audio tracks
    const cdnUrl = await getDownloadLink(torrentId, fileId);
    const tracks = await probeAudioTracks(cdnUrl);
    const audioTracks = tracks.length > 0 ? tracks : [{ index: 0, codec: 'aac', language: 'und', title: 'Default', channels: 2 }];

    // Generate master playlist
    //
    // The token is written into every URI rather than left to query-string inheritance:
    // hls.js/url-toolkit only inherits the base query when the relative path is empty, so a
    // relative `audio_0/playlist.m3u8` would be requested without the token and 401.
    const mediaToken = req.query.t;
    const mediaQuery = mediaToken ? `?t=${encodeURIComponent(String(mediaToken))}` : '';
    const audioEntries: string[] = [];
    for (let i = 0; i < audioTracks.length; i++) {
      const t = audioTracks[i];
      const lang = t.language || 'und';
      const name = t.title || `Track ${i}`;
      const isDefault = i === 0 ? 'YES' : 'NO';
      audioEntries.push(`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="${name}",LANGUAGE="${lang}",DEFAULT=${isDefault},AUTOSELECT=${isDefault},URI="audio_${i}/playlist.m3u8${mediaQuery}"`);
    }
    let master = '#EXTM3U\n#EXT-X-VERSION:4\n' + audioEntries.join('\n') + '\n';
    master += '#EXT-X-STREAM-INF:BANDWIDTH=5000000,AUDIO="audio"\n';
    master += `audio_0/playlist.m3u8${mediaQuery}\n`;

    writeFileSync(masterPath, master);

    // Spawn parallel ffmpeg processes for each audio track
    //
    // One set of encoders per cache key, and never more than MAX_FFMPEG_PROCS overall:
    // every concurrent cache miss used to spawn its own encoders into the same directory,
    // so N viewers of one title meant N processes racing on the same seg_%05d.ts files.
    const alreadyTranscoding = hlsInFlight.has(cacheKey);
    const spawned: import('child_process').ChildProcess[] = [];
    if (!alreadyTranscoding) {
      if (hlsChildren.size + audioTracks.length > config.MAX_FFMPEG_PROCS) {
        return sendError(res, 503, 'Too many concurrent transcodes right now. Try again shortly.');
      }
      hlsInFlight.add(cacheKey);
    }

    for (let i = 0; i < audioTracks.length && !alreadyTranscoding; i++) {
      const trackIndex = audioTracks[i].index;
      const args = [
        '-hide_banner', '-loglevel', 'error',
        '-i', cdnUrl,
        '-map', '0:v:0',
        '-map', `0:a:${trackIndex}`,
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '192k',
        '-f', 'hls',
        '-hls_time', '4',
        '-hls_list_size', '0',
        '-hls_segment_type', 'mpegts',
        '-hls_segment_filename', path.join(cacheDir, `audio_${i}`, 'seg_%05d.ts'),
        path.join(cacheDir, `audio_${i}`, 'playlist.m3u8'),
      ];
      const proc = spawn(ffmpegPath, args, { stdio: 'ignore', detached: true });
      trackChild(proc, 'hls');
      proc.unref();
      spawned.push(proc);
      console.log(`[HLS] Started ffmpeg for audio track ${i} (${audioTracks[i].language}): PID ${proc.pid}`);
    }

    // Release the per-key claim once every encoder for it has exited.
    if (!alreadyTranscoding && spawned.length) {
      let remaining = spawned.length;
      const release = () => { if (--remaining <= 0) hlsInFlight.delete(cacheKey); };
      for (const child of spawned) {
        child.on('exit', release);
        child.on('error', release);
      }
    }

    cacheAccess.set(cacheKey, Date.now());

    // Wait briefly for first segments to appear (up to 10 seconds)
    for (let w = 0; w < 100; w++) {
      try {
        const plPath = path.join(cacheDir, 'audio_0', 'playlist.m3u8');
        const content = readFileSync(plPath, 'utf8');
        if (content.includes('#EXTINF:')) break;
      } catch { /* not ready yet */ }
      await new Promise(r => setTimeout(r, 100));
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    return res.sendFile(masterPath);
  } catch (error: any) {
    console.error('[HLS] Error:', error.message);
    return sendError(res, 500, 'HLS segmentation failed.', error);
  }
});

// Serve HLS segments and playlists
app.get('/api/hls/:torrentId/:fileId/*', authMiddleware, (req: AuthRequest, res: Response) => {
  const { torrentId, fileId } = req.params;
  const cacheDir = hlsCacheDir(torrentId, fileId);
  if (!cacheDir) {
    log('warn', 'Rejected HLS segment request with invalid ids', { torrentId, fileId, ip: clientIp(req) });
    return res.status(400).end();
  }

  const subPath = req.params[0]; // everything after the wildcard
  if (!subPath) return res.status(400).end();

  // Resolve instead of substring-testing: the old `subPath.includes('..')` guard covered
  // only this wildcard remainder, never the two id params that build the directory above.
  const filePath = path.resolve(cacheDir, subPath);
  if (!filePath.startsWith(cacheDir + path.sep)) {
    log('warn', 'Blocked HLS path escape', { torrentId, fileId, subPath, ip: clientIp(req) });
    return res.status(400).end();
  }
  cacheAccess.set(`${torrentId}_${fileId}`, Date.now());

  try {
    if (!statSync(filePath).isFile()) return res.status(404).end();
  } catch { return res.status(404).end(); }

  if (filePath.endsWith('.m3u8')) {
    // Rewrite the token into every URI and segment line. hls.js does not carry a base query
    // string onto relative URIs, and the segment playlists ffmpeg writes contain plain
    // `seg_00001.ts` names, so without this step variant and segment requests 401.
    const token = req.query.t;
    const suffix = token ? `?t=${encodeURIComponent(String(token))}` : '';
    let body: string;
    try {
      body = readFileSync(filePath, 'utf8');
    } catch {
      return res.status(404).end();
    }
    const rewritten = body
      .split('\n')
      .map((line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        if (trimmed.startsWith('#')) {
          if (!suffix) return line;
          return line.replace(/URI="([^"]+)"/gi, (_m: string, u: string) =>
            /^https?:\/\//i.test(u) ? `URI="${u}"` : `URI="${u}${suffix}"`,
          );
        }
        return `${trimmed}${suffix}`;
      })
      .join('\n');
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(rewritten);
  }
  if (filePath.endsWith('.ts')) {
    res.setHeader('Content-Type', 'video/mp2t');
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
});


// --- External stream proxy (no separate sudo-proxy/CF worker needed) ---
// Proxies external HLS/media URLs so the browser can fetch them (CORS/geo
// blocks), rewriting .m3u8 playlists so every segment also flows through the
// backend. This mirrors how TorBox HLS is already served via /api/hls.
const SCRAPER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

app.options('/api/proxy', (_req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Authorization, Content-Type');
  return res.status(204).end();
});

// Guarded outbound agents for the stream proxy (see http.ts).
const proxyAgents = createGuardedAgents();

// The proxy is an outbound fetcher, i.e. the most abusable route in the app, and it had no
// throttle at all. 120 requests/minute per caller covers playlist + segment fetching.
const proxyLimiter = new RateLimiter(120, 60_000);

// Guarded max bytes for a rewritten playlist body.
const PLAYLIST_BUFFER_LIMIT = config.PROXY_MAX_BYTES;

app.get('/api/proxy', async (req: Request, res: Response) => {
  // This route makes the server fetch a URL of the caller's choosing, so it is the most
  // sensitive surface here: require a valid token unless auth is explicitly disabled.
  if (!config.authDisabled) {
    const token = extractToken(req);
    if (!token || !verifyJwt(token)) {
      return res.status(401).json({ success: false, detail: 'Unauthorized.' });
    }
  }

  const target = req.query.url as string | undefined;
  if (!target) {
    return res.status(400).json({ success: false, detail: 'A valid http(s) url is required.' });
  }

  const { limited, retryAfterSeconds } = proxyLimiter.check(clientIp(req));
  if (limited) {
    res.setHeader('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({ success: false, detail: 'Too many proxy requests. Slow down.' });
  }
  // Pre-flight validation for a clear error, plus the guarded agents below which enforce
  // it at connect time. The old check was a regex over the raw URL string, which decimal
  // or hex IP forms, IPv4-mapped IPv6, and redirects into private space all walked past.
  const targetCheck = await assertPublicHttpUrl(target, config.PROXY_ALLOWED_HOSTS);
  if (!targetCheck.ok) {
    log('warn', 'Blocked proxy target', { reason: targetCheck.reason, host: hostOf(target), ip: clientIp(req) });
    return res.status(400).json({ success: false, detail: 'URL not allowed.' });
  }

  // Relative URLs on purpose: hls.js resolves them against the playlist it just fetched,
  // so rewritten links stay on our own origin without consulting the request Host header,
  // which the caller controls. Building an absolute URL from it let a spoofed Host send the
  // token below to an attacker's host.
  const tParam = req.query.t ? `&t=${encodeURIComponent(String(req.query.t))}` : '';

  const rewriteSegment = (u: string): string => {
    const absolute = /^https?:\/\//i.test(u) ? u : new URL(u, target).href;
    return `/api/proxy?url=${encodeURIComponent(absolute)}${tParam}`;
  };

  const headers: Record<string, string> = {
    'User-Agent': SCRAPER_UA,
    Accept: '*/*',
  };
  if (req.headers.range) headers.Range = String(req.headers.range);
  if (req.headers.referer) headers.Referer = String(req.headers.referer);

  try {
    const resp = await axios.get(target, {
      responseType: 'stream',
      timeout: 15000,
      maxRedirects: 5,
      headers,
      // Private-address rejection happens in the agent's DNS lookup, so it also covers
      // every redirect hop rather than only the URL the caller supplied.
      httpAgent: proxyAgents.httpAgent,
      httpsAgent: proxyAgents.httpsAgent,
      validateStatus: (s: number) => s >= 200 && s < 400,
    });

    const contentType = String(resp.headers['content-type'] || 'application/octet-stream');
    const isPlaylist = /mpegurl|m3u8/i.test(contentType) || /\.m3u8($|\?)/i.test(target);

    if (isPlaylist) {
      let body = '';
      let bytes = 0;
      let overflowed = false;
      resp.data.on('data', (chunk: Buffer) => {
        if (overflowed) return;
        // Measure bytes, not UTF-16 code units: `body.length` under-counted non-ASCII
        // playlists, and the previous string concat could split a multibyte character.
        bytes += chunk.length;
        if (bytes > PLAYLIST_BUFFER_LIMIT) {
          overflowed = true;
          log('warn', 'Playlist exceeded PROXY_MAX_BYTES', { limit: PLAYLIST_BUFFER_LIMIT, host: hostOf(target) });
          try { resp.data.destroy(); } catch { /* ignore */ }
          if (!res.headersSent) res.status(502).json({ success: false, detail: 'Playlist too large.' });
          return;
        }
        body += chunk.toString('utf8');
      });
      resp.data.on('error', () => { if (!res.headersSent) res.status(502).end(); else res.end(); });
      resp.data.on('end', () => {
        if (overflowed) return;
        const rewritten = body.split('\n').map((line: string) => {
          if (line.startsWith('#')) {
            return line.replace(/URI="([^"]+)"/gi, (_m: string, u: string) => `URI="${rewriteSegment(u)}"`);
          }
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          return rewriteSegment(trimmed);
        }).join('\n');
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.send(rewritten);
      });
      return;
    }

    // Stream media through (video segments, mp4, etc.)
    res.setHeader('Content-Type', contentType);
    if (resp.headers['content-length']) res.setHeader('Content-Length', String(resp.headers['content-length']));
    if (resp.headers['accept-ranges']) res.setHeader('Accept-Ranges', String(resp.headers['accept-ranges']));
    if (resp.headers['content-range']) res.setHeader('Content-Range', String(resp.headers['content-range']));
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.status(resp.status);
    resp.data.pipe(res);
    req.on('close', () => { try { resp.data.destroy(); } catch { /* ignore */ } });
  } catch (error: any) {
    if (!res.headersSent) {
      sendError(res, 502, 'Proxy fetch failed.', error);
    } else {
      res.end();
    }
  }
});
// --- Local Media ---
const LOCAL_MEDIA_DIR = process.env.LOCAL_MEDIA_DIR || '/root/streamvault-local';

// List local media files
app.get('/api/local/files', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    if (!existsSync(LOCAL_MEDIA_DIR)) {
      mkdirSync(LOCAL_MEDIA_DIR, { recursive: true });
      return res.json({ success: true, data: [] });
    }
    const files = readdirSync(LOCAL_MEDIA_DIR).filter((f: string) => {
      const ext = f.split('.').pop()?.toLowerCase();
      return ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v'].includes(ext || '');
    });
    const data = files.map((name: string, i: number) => ({
      id: `local-${i}`,
      name,
      size: statSync(path.join(LOCAL_MEDIA_DIR, name)).size,
      type: 'local',
    }));
    return res.json({ success: true, data });
  } catch (e: any) {
    return sendError(res, 500, 'Request failed.', e);
  }
});

// Stream local media file (no auth for direct video embedding)
app.get('/api/local/stream/:filename', authMiddleware, (req: AuthRequest, res: Response) => {
  // Resolve to an absolute path and require the real path to stay inside the media root.
  // path.join alone let a symlink inside that directory point anywhere on disk.
  const requested = path.basename(req.params.filename);
  const mediaRoot = path.resolve(LOCAL_MEDIA_DIR);
  let filePath = path.resolve(mediaRoot, requested);
  try {
    filePath = fsRealpath(filePath);
  } catch {
    return res.status(404).json({ success: false, detail: 'File not found.' });
  }
  if (filePath !== mediaRoot && !filePath.startsWith(mediaRoot + path.sep)) {
    log('warn', 'Blocked local path outside media root', { requested, ip: clientIp(req) });
    return res.status(404).json({ success: false, detail: 'File not found.' });
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return res.status(404).json({ success: false, detail: 'File not found.' });
  }
  const filename = requested;

  const stat = statSync(filePath);
  const fileSize = stat.size;
  const ext = filename.split('.').pop()?.toLowerCase();
  const mime = ext === 'mp4' ? 'video/mp4' : ext === 'mkv' ? 'video/x-matroska' : 'video/webm';

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*',
    });

    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    });
    createReadStream(filePath).pipe(res);
  }
});
// Serve the built frontend in production
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(frontendDist));
// SPA fallback: non-API routes serve index.html
app.get('*', (req: Request, res: Response) => {
  if (req.path.startsWith('/api')) return res.status(404).end();
  const indexHtml = path.join(frontendDist, 'index.html');
  if (!existsSync(indexHtml)) {
    return res.status(503).json({ success: false, detail: 'Frontend build not found. Run the frontend build.' });
  }
  res.sendFile(indexHtml);
});

// Start Express server
const server = http.createServer(app);
server.listen(PORT, () => {
  log('info', 'Server listening', {
    port: PORT,
    env: config.env,
    ffmpeg: ffmpegPath,
    ffprobe: ffprobePath,
    auth: config.authDisabled ? 'disabled' : 'enabled',
  });
  if (config.PROXY_ALLOWED_HOSTS.length) {
    log('info', 'Stream proxy restricted to allowlist', { hosts: config.PROXY_ALLOWED_HOSTS.join(',') });
  }
});

// --- Graceful shutdown ------------------------------------------------------
// ffmpeg children are detached/pipe-fed and previously outlived the process, which left
// orphaned encoders and half-written HLS cache directories behind on every restart.
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) {
    // A second signal is an operator saying "stop now". Without this the request was
    // silently swallowed and the process stayed up for the full grace window.
    log('warn', `Second ${signal}, exiting immediately`);
    for (const child of ffmpegChildren) {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }
    process.exit(1);
  }
  shuttingDown = true;
  log('info', `Received ${signal}, shutting down`);

  // The cache sweeper interval is referenced, so leaving it running kept the event loop
  // alive past server.close() and made every restart wait out the grace window.
  clearInterval(hlsCacheSweeper);

  server.close(() => log('info', 'HTTP server closed'));
  // Drop idle keep-alive sockets too, or close() waits on connections that will never send.
  server.closeAllConnections?.();

  for (const child of ffmpegChildren) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
  // Nothing left to wait for: exit now rather than sitting in the grace window, so a
  // restart with no active streams is immediate instead of always taking 5 seconds.
  if (ffmpegChildren.size === 0) {
    process.exit(0);
  }
  // Give in-flight requests a moment, then stop reaping stragglers the hard way.
  setTimeout(() => {
    for (const child of ffmpegChildren) {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
    }
    process.exit(0);
  }, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled promise rejection', { reason: reason instanceof Error ? reason.message : String(reason) });
});