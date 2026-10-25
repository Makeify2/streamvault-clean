import axios from 'axios';
import type { ScrapeRequest } from './types';

export const SCRAPER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * Builds a client-facing URL for a media/embed resource.
 *
 * - If STREAM_PROXY is configured it is used verbatim as a URL prefix
 *   (legacy sudo-proxy/CF worker style: `${proxy}${encodeURIComponent(url)}`).
 * - Otherwise the URL is routed through the backend's own `/api/proxy` route,
 *   which handles CORS, geo blocks, and HLS playlist rewriting - no external
 *   proxy service required (this matches how StreamVault already serves TorBox
 *   HLS through the backend).
 * - With neither configured the raw URL is returned (direct browser embeds).
 */
export function viaProxy(url: string, req?: ScrapeRequest): string {
  const encoded = encodeURIComponent(url);
  if (process.env.STREAM_PROXY) return `${process.env.STREAM_PROXY}${encoded}`;
  const base = req?.proxyBase?.replace(/\/+$/, '');
  if (base) return `${base}/api/proxy?url=${encoded}`;
  return url;
}

/** Server-side text fetch. Uses STREAM_PROXY when configured, otherwise direct. */
export async function fetchText(url: string): Promise<string | null> {
  const proxy = process.env.STREAM_PROXY;
  const target = proxy ? `${proxy}${encodeURIComponent(url)}` : url;
  try {
    const res = await axios.get(target, {
      timeout: 8000,
      maxRedirects: 5,
      headers: {
        'User-Agent': SCRAPER_UA,
        Referer: new URL(url).origin,
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
    });
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  } catch {
    return null;
  }
}

/** Resolves relative URLs (including protocol-relative) against a base. */
export function absolutize(base: string, url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** Extracts the first .m3u8 URL found in a scraped page. */
export function extractM3u8(html: string): string | null {
  const patterns = [
    /["']([^"']+\.m3u8[^"']*)["']/i,
    /(?:src|url|file)\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i,
    /(?:https?:)?\/\/[^"'\s]+\.m3u8[^"'\s]*/i,
  ];
  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m?.[1]) return m[1].replace(/\\\//g, '/');
  }
  return null;
}
