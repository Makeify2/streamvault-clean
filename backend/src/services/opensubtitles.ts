import axios from 'axios';

const OS_BASE = 'https://api.opensubtitles.com/api/v1';

// OpenSubtitles' WAF rejects a custom User-Agent on the /download path with a 503
// (see getSubtitleDownloadUrl). Search accepts anything, so only download uses this.
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

let cachedToken: string | null = null;
let tokenExpiry = 0;

function getApiKey(): string {
  const key = process.env.OPENSUBTITLES_API_KEY;
  if (!key || key === 'your_opensubtitles_api_key_here') {
    throw new Error('OPENSUBTITLES_API_KEY is not configured in .env');
  }
  return key;
}

async function buildHeaders(): Promise<Record<string, string>> {
  const key = getApiKey();
  const headers: Record<string, string> = {
    'Api-Key': key,
    'Content-Type': 'application/json',
    'User-Agent': 'StreamVault/1.0',
  };

  const username = process.env.OPENSUBTITLES_USERNAME;
  const password = process.env.OPENSUBTITLES_PASSWORD;

  if (username && password) {
    if (!cachedToken || Date.now() >= tokenExpiry) {
      try {
        const resp = await axios.post(
          `${OS_BASE}/login`,
          { username, password },
          { headers: { 'Api-Key': key, 'Content-Type': 'application/json', 'User-Agent': 'StreamVault/1.0' } }
        );
        cachedToken = resp.data.token;
        tokenExpiry = Date.now() + 23 * 3600 * 1000;
      } catch (e: any) {
        console.warn('[OpenSubtitles] Login failed, continuing as anonymous:', e.message);
      }
    }
    if (cachedToken) headers['Authorization'] = `Bearer ${cachedToken}`;
  }

  return headers;
}

export interface OSSubtitleResult {
  fileId: number;
  fileName: string;
  language: string;   // ISO 639-1 code e.g. "en"
  displayName: string;
  downloadCount: number;
  seasonNumber?: number;
  episodeNumber?: number;
}

export async function searchSubtitles(opts: {
  tmdbId?: number;
  type?: 'movie' | 'tv';
  query?: string;
  season?: number;
  episode?: number;
}): Promise<OSSubtitleResult[]> {
  const headers = await buildHeaders();

  const runQuery = async (withEpisode: boolean): Promise<OSSubtitleResult[]> => {
    const params: Record<string, string> = {
      order_by: 'download_count',
      order_direction: 'desc',
    };
    if (opts.tmdbId) { params.tmdb_id = String(opts.tmdbId); }
    if (opts.type)   { params.type = opts.type; }
    if (opts.query)  { params.query = opts.query; }

    // TV: OpenSubtitles returns ZERO results for a bare tmdb_id+type=tv. It needs the
    // season (and ideally the episode) to match anything. Verified Sep 2026 on
    // Redo of Healer (tmdb 99071): no season -> 0 results, season 1 -> 50, S1E1 -> 13.
    if (opts.type === 'tv' && opts.season) {
      params.season_number = String(opts.season);
      if (withEpisode && opts.episode) params.episode_number = String(opts.episode);
    }

    const resp = await axios.get(`${OS_BASE}/subtitles`, {
      params,
      headers,
      timeout: 10000,
    });

    const raw: any[] = resp.data?.data || [];
    const out: OSSubtitleResult[] = [];

    for (const item of raw) {
      const attrs = item.attributes;
      if (!attrs?.files?.length) continue;
      const file = attrs.files[0];
      out.push({
        fileId: file.file_id,
        fileName: file.file_name || attrs.release || '',
        language: attrs.language || 'und',
        displayName: attrs.language || 'und',
        downloadCount: attrs.download_count || 0,
        seasonNumber: attrs.season_number ?? undefined,
        episodeNumber: attrs.episode_number ?? undefined,
      });
    }

    // Return every option (the UI groups by language and lets the user pick a specific
    // release), still ordered by download count. Capped so the payload stays sane.
    return out.slice(0, 60);
  };

  let results = await runQuery(true);
  // Anime and season packs often aren't tagged per episode: fall back to season-wide
  // results when the episode-specific query comes up empty.
  if (results.length === 0 && opts.type === 'tv' && opts.season && opts.episode) {
    results = await runQuery(false);
  }
  return results;
}

export async function getSubtitleDownloadUrl(fileId: number): Promise<string> {
  const headers = await buildHeaders();

  // The /download endpoint sits behind OpenSubtitles' WAF, which answers a custom
  // User-Agent with a 503 HTML error page (the same key and the /subtitles search
  // endpoint work fine). Presenting a browser UA + the usual browser headers on this
  // one call is what makes it return a link. Verified Sep 2026: 'StreamVault/1.0' -> 503,
  // Chrome UA -> 200 {"link": ...}. Retry once in case their edge is just flaky.
  const wafSafeHeaders = {
    ...headers,
    'User-Agent': BROWSER_UA,
    Accept: 'application/json',
    Origin: 'https://www.opensubtitles.com',
    Referer: 'https://www.opensubtitles.com/',
  };

  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await axios.post(
        `${OS_BASE}/download`,
        { file_id: fileId },
        { headers: wafSafeHeaders, timeout: 10000 }
      );
      if (!resp.data?.link) {
        throw new Error(resp.data?.message || 'OpenSubtitles returned no download link.');
      }
      return resp.data.link;
    } catch (err: any) {
      lastErr = err;
      if (attempt === 0) await new Promise(r => setTimeout(r, 700));
    }
  }
  throw lastErr;
}
