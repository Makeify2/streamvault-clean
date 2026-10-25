// Prefixes API paths with the backend URL (set via VITE_API_BASE env var).
// In development, Vite's dev server proxies /api to localhost:5000.

const API_BASE = import.meta.env.VITE_API_BASE || '';

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

/**
 * True when a URL points at this app's own API — same origin as the page, or the
 * configured VITE_API_BASE. Used to decide whether a URL is safe to attach the session
 * token to: substring-matching '/api/proxy?' was not enough, because a scrape result can
 * carry an absolute third-party URL containing that text.
 */
export function isOwnApiUrl(url: string): boolean {
  try {
    const resolved = new URL(url, window.location.origin);
    if (resolved.origin === window.location.origin) return true;
    return API_BASE ? resolved.origin === new URL(API_BASE, window.location.origin).origin : false;
  } catch {
    return false;
  }
}

/**
 * Routes an external stream URL through the backend's /api/proxy so hls.js can
 * load it same-origin (no sudo-proxy deployment needed). Relative URLs and URLs
 * already pointing at our own backend are passed through untouched; anything else,
 * including a third-party URL that merely contains '/api/proxy?', is wrapped so the
 * browser only ever sends the session token to our own origin.
 */
export function proxyStreamUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('/')) return url;
  if (isOwnApiUrl(url)) return url;
  if (/^https?:\/\//i.test(url)) {
    return apiUrl(`/api/proxy?url=${encodeURIComponent(url)}`);
  }
  return url;
}
/**
 * Appends the session token as ?t= for routes that the browser fetches without headers
 * (<video src>, <track src>, hls.js requests). The backend now requires auth on the
 * subtitle and local-media routes, so these URLs must carry the token.
 */
export function withMediaToken(url: string, token: string | null | undefined): string {
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`;
}
