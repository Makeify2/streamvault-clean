import fs from 'fs';
import path from 'path';
import { parseMediaName, ParsedMedia } from '../utils/parser';
import * as tmdb from './tmdb';
import { TorBoxTorrent } from './torbox';

const CACHE_DIR = path.join(__dirname, '../../data');
const CACHE_FILE = path.join(CACHE_DIR, 'mappings.json');

export interface MappedMetadata {
  tmdbId?: number;
  title: string;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  releaseDate?: string;
  rating?: number;
  genres?: string[];
  type: 'movie' | 'tv' | 'other';
  /** False when the torrent looks like a game/software release rather than a film or show. */
  isMedia?: boolean;
  parsed: ParsedMedia;
  lastUpdated: number;
}

export interface MappedTorrent extends TorBoxTorrent {
  metadata: MappedMetadata;
}

let cache: Record<string, MappedMetadata> = {};

// Helper to ensure cache directory and file exist
function initCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf-8');
      cache = JSON.parse(data);
    } else {
      cache = {};
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
    }
  } catch (error) {
    console.error('Failed to initialize mapping cache database:', error);
  }
}

// Helper to save cache to file
function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save mapping cache database:', error);
  }
}

// Initialize on load
initCache();

/**
 * Searches TMDb for media details using the parsed media info.
 */
async function fetchMetadata(parsed: ParsedMedia): Promise<Partial<MappedMetadata> | null> {
  const isTV = parsed.type === 'tv';
  let results: tmdb.TMDbMedia[] = [];
  
  if (isTV) {
    results = await tmdb.searchTV(parsed.title, parsed.year);
    // Fallback: search movie if TV search failed
    if (results.length === 0) {
      results = await tmdb.searchMovie(parsed.title, parsed.year);
    }
  } else {
    results = await tmdb.searchMovie(parsed.title, parsed.year);
    // Fallback: search TV if movie search failed
    if (results.length === 0) {
      results = await tmdb.searchTV(parsed.title, parsed.year);
    }
  }
  
  if (results.length === 0) {
    // If still no results, try searching without the year if it was provided
    if (parsed.year) {
      if (isTV) {
        results = await tmdb.searchTV(parsed.title);
      } else {
        results = await tmdb.searchMovie(parsed.title);
      }
    }
  }
  
  if (results.length === 0) {
    return null;
  }
  
  const candidate = results[0];
  const detectedType = candidate.title ? 'movie' : 'tv'; // TMDb movies have title, TV shows have name
  
  // Fetch detailed metadata
  let details: any = null;
  if (detectedType === 'movie') {
    details = await tmdb.getMovieDetails(candidate.id);
  } else {
    details = await tmdb.getTVDetails(candidate.id);
  }
  
  if (!details) {
    details = candidate;
  }
  
  return {
    tmdbId: details.id,
    title: details.title || details.name || parsed.title,
    overview: details.overview,
    posterPath: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : undefined,
    backdropPath: details.backdrop_path ? `https://image.tmdb.org/t/p/original${details.backdrop_path}` : undefined,
    releaseDate: details.release_date || details.first_air_date,
    rating: details.vote_average,
    genres: details.genres?.map((g: any) => g.name) || [],
    type: detectedType
  };
}

/**
 * Maps a single torrent with metadata, using caching.
 */
export async function getMappedTorrent(torrent: TorBoxTorrent): Promise<MappedTorrent> {
  const parsed = parseMediaName(torrent.name);
  const cacheKey = torrent.hash.toLowerCase();

  // Successful matches stay cached for 7 days; failed lookups retry after 1 hour
  // so an improved parse or a late TMDb listing can fix them.
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  const oneHour = 60 * 60 * 1000;
  const cached = cache[cacheKey];
  if (cached) {
    const ttl = cached.tmdbId || cached.isMedia === false ? oneWeek : oneHour;
    if (Date.now() - cached.lastUpdated < ttl) {
      return {
        ...torrent,
        metadata: { ...cached, isMedia: cached.isMedia ?? parsed.isMedia }
      };
    }
  }

  // Games/software: don't waste TMDb searches on titles that will only mismatch
  if (!parsed.isMedia) {
    cache[cacheKey] = {
      title: parsed.title,
      type: parsed.type,
      isMedia: false,
      parsed,
      lastUpdated: Date.now()
    };
    saveCache();
    return { ...torrent, metadata: cache[cacheKey] };
  }

  try {
    const fetched = await fetchMetadata(parsed);

    if (fetched) {
      cache[cacheKey] = {
        tmdbId: fetched.tmdbId,
        title: fetched.title || parsed.title,
        overview: fetched.overview,
        posterPath: fetched.posterPath,
        backdropPath: fetched.backdropPath,
        releaseDate: fetched.releaseDate,
        rating: fetched.rating,
        genres: fetched.genres,
        type: fetched.type || parsed.type,
        isMedia: true,
        parsed,
        lastUpdated: Date.now()
      };
    } else {
      // Create a fallback mapping if TMDb search failed
      cache[cacheKey] = {
        title: parsed.title,
        type: parsed.type,
        isMedia: true,
        parsed,
        lastUpdated: Date.now()
      };
    }

    saveCache();
  } catch (error) {
    console.error(`Error mapping torrent "${torrent.name}":`, error);
    // Don't crash, return basic info
    return {
      ...torrent,
      metadata: cache[cacheKey] || {
        title: parsed.title,
        type: parsed.type,
        isMedia: parsed.isMedia,
        parsed,
        lastUpdated: Date.now()
      }
    };
  }

  return {
    ...torrent,
    metadata: cache[cacheKey]
  };
}

/**
 * Maps a list of torrents.
 */
export async function mapTorrents(torrents: TorBoxTorrent[]): Promise<MappedTorrent[]> {
  // Chunked so a large library's first load doesn't hammer TMDb's rate limit
  const results: MappedTorrent[] = [];
  const chunkSize = 8;
  for (let i = 0; i < torrents.length; i += chunkSize) {
    const chunk = torrents.slice(i, i + chunkSize);
    results.push(...await Promise.all(chunk.map(t => getMappedTorrent(t))));
  }
  return results;
}

/**
 * Force manual update of TMDb mapping for a specific torrent
 */
export async function updateMapping(
  hash: string,
  tmdbId: number,
  type: 'movie' | 'tv' | 'other'
): Promise<MappedMetadata> {
  const cacheKey = hash.toLowerCase();

  // "Other" = games, software, docs — non-media, no TMDb fetch
  if (type === 'other') {
    const existing = cache[cacheKey];
    cache[cacheKey] = {
      tmdbId: undefined,
      title: existing?.title || 'Other',
      type: 'other',
      isMedia: false,
      parsed: existing?.parsed || parseMediaName(''),
      lastUpdated: Date.now()
    };
    saveCache();
    return cache[cacheKey];
  }

  let details: any = null;
  if (type === 'movie') {
    details = await tmdb.getMovieDetails(tmdbId);
  } else {
    details = await tmdb.getTVDetails(tmdbId);
  }

  if (!details) {
    throw new Error('Failed to fetch details from TMDb for manual mapping.');
  }

  const parsed = cache[cacheKey]?.parsed || parseMediaName(details.title || details.name);

  cache[cacheKey] = {
    tmdbId,
    title: details.title || details.name,
    overview: details.overview,
    posterPath: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : undefined,
    backdropPath: details.backdrop_path ? `https://image.tmdb.org/t/p/original${details.backdrop_path}` : undefined,
    releaseDate: details.release_date || details.first_air_date,
    rating: details.vote_average,
    genres: details.genres?.map((g: any) => g.name) || [],
    type,
    isMedia: true,
    parsed,
    lastUpdated: Date.now()
  };

  saveCache();
  return cache[cacheKey];
}
