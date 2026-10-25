import axios from 'axios';
import type { ScrapeRequest, ScrapeResult, SourceScraper, ScrapeStatusEvent } from './types';

const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce',
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function magnet(hash: string, name: string): string {
  const tr = TRACKERS.map(t => `tr=${encodeURIComponent(t)}`).join('&');
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}&${tr}`;
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function titleMatches(req: ScrapeRequest, candidate: string): boolean {
  const needle = normalizeTitle(req.title);
  const hay = normalizeTitle(candidate);
  if (!needle || !hay) return false;
  if (hay === needle || hay.includes(needle)) return true;
  const tokens = needle.split(' ').filter(t => t.length > 2);
  if (tokens.length === 0) return false;
  const hits = tokens.filter(t => hay.includes(t)).length;
  return hits / tokens.length >= 0.6;
}

function yearMatches(req: ScrapeRequest, candidate: string): boolean {
  if (!req.year) return true;
  const year = candidate.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
  return !year || year === String(req.year);
}

function guessQuality(name: string): string | undefined {
  const n = name.toLowerCase();
  if (/2160p|4k|uhd/.test(n)) return '4K';
  if (/1080p/.test(n)) return '1080p';
  if (/720p/.test(n)) return '720p';
  return undefined;
}

// --- YTS (movies only, official JSON API) ---

interface YtsResponse {
  data?: {
    movies?: Array<{
      title: string;
      year: number;
      torrents?: Array<{ hash: string; quality: string; size: string; seeds: number }>;
    }>;
  };
}

async function searchYTS(req: ScrapeRequest): Promise<ScrapeResult | null> {
  const query = encodeURIComponent(req.title);
  const url = `https://yts.mx/api/v2/list_movies.json?query_term=${query}&limit=20`;
  const res = await axios.get(url, { timeout: 8000, headers: { 'User-Agent': UA } });
  const body = res.data as YtsResponse;
  const movie = body.data?.movies?.find(m => titleMatches(req, m.title) && (req.year === undefined || m.year === req.year));
  if (!movie || !movie.torrents?.length) return null;
  const best = [...movie.torrents].sort((a, b) => b.seeds - a.seeds)[0];
  return {
    sourceId: 'yts',
    name: 'YTS',
    kind: 'torrent',
    quality: best.quality,
    magnet: magnet(best.hash, movie.title),
    hash: best.hash,
    isCached: false,
    size: parseSize(best.size),
    message: `${movie.title} (${movie.year}) — ${best.quality}`,
  };
}

function parseSize(size: string): number | undefined {
  const m = size.trim().match(/^([\d.]+)\s*(B|KB|MB|GB|TB)$/i);
  if (!m) return undefined;
  const value = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const mult: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return Math.round(value * mult[unit]);
}

// --- 1337x (HTML scrape, best effort) ---

async function search1337x(req: ScrapeRequest): Promise<ScrapeResult | null> {
  const query = encodeURIComponent(req.title.split(' ').join('-'));
  const url = `https://1337x.to/search/${query}/1/`;
  const proxy = process.env.STREAM_PROXY;
  const target = proxy ? `${proxy}${encodeURIComponent(url)}` : url;
  const res = await axios.get(target, {
    timeout: 8000,
    headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
  });
  const html = typeof res.data === 'string' ? res.data : '';

  // Rows look like: <a href="/torrent/12345/Title-1080p/">Title 1080p</a> ... <td>2.4 GB</td> ... seeds
  const rows = html.match(/<a href="\/torrent\/\d+\/[^"]+"[^>]*>([^<]+)<\/a>/gi) || [];
  const candidates = rows
    .map(row => row.match(/href="\/torrent\/(\d+)\/([^"]+)"/i)?.[2])
    .filter((slug): slug is string => !!slug)
    .map(slug => slug.replace(/-/g, ' '))
    .filter(name => titleMatches(req, name) && yearMatches(req, name));

  if (candidates.length === 0) return null;
  const name = candidates[0];
  const hashMatch = html.match(/magnet:\?xt=urn:btih:([a-fA-F0-9]{40})/i);
  const hash = hashMatch?.[1];
  if (!hash) return null;

  return {
    sourceId: '1337x',
    name: '1337x',
    kind: 'torrent',
    quality: guessQuality(name),
    magnet: magnet(hash, name),
    hash,
    isCached: false,
    message: `Found on 1337x (${name})`,
  };
}

// --- TorrentGalaxy (HTML scrape, best effort) ---

async function searchTGx(req: ScrapeRequest): Promise<ScrapeResult | null> {
  const query = encodeURIComponent(req.title);
  const url = `https://torrentgalaxy.to/torrents.php?search=${query}#results`;
  const proxy = process.env.STREAM_PROXY;
  const target = proxy ? `${proxy}${encodeURIComponent(url)}` : url;
  const res = await axios.get(target, {
    timeout: 8000,
    headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
  });
  const html = typeof res.data === 'string' ? res.data : '';

  const magnetMatch = html.match(/magnet:\?xt=urn:btih:([a-fA-F0-9]{40})/i);
  const hash = magnetMatch?.[1];
  if (!hash) return null;

  const titleTag = html.match(/<title>([^<]+)<\/title>/i)?.[1] || req.title;
  const name = titleTag.replace(/download|torrent|galaxy|\./gi, '').trim() || req.title;
  if (!titleMatches(req, name)) return null;

  return {
    sourceId: 'tgx',
    name: 'TorrentGalaxy',
    kind: 'torrent',
    quality: guessQuality(name),
    magnet: magnet(hash, name),
    hash,
    isCached: false,
    message: `Found on TorrentGalaxy (${name})`,
  };
}

function makeIndexerScraper(
  id: string,
  name: string,
  fn: (req: ScrapeRequest) => Promise<ScrapeResult | null>,
): SourceScraper {
  return {
    id,
    name,
    kind: 'torrent' as const,
    async scrape(req: ScrapeRequest, emit: (event: ScrapeStatusEvent) => void): Promise<ScrapeResult | null> {
      emit({ sourceId: id, name, status: 'searching', message: `Searching ${name}...` });
      try {
        const result = await fn(req);
        if (result) return result;
        emit({ sourceId: id, name, status: 'failed', message: `Not found on ${name}` });
        return null;
      } catch (e: any) {
        emit({ sourceId: id, name, status: 'failed', message: `${name} unreachable (${e?.message || 'error'})` });
        return null;
      }
    },
  };
}

export function createIndexerScrapers(): SourceScraper[] {
  return [
    makeIndexerScraper('yts', 'YTS', searchYTS),
    makeIndexerScraper('1337x', '1337x', search1337x),
    makeIndexerScraper('tgx', 'TorrentGalaxy', searchTGx),
  ];
}
