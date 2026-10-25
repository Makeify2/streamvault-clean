/**
 * Shared HTTP hardening helpers: error responses that do not leak internals, a small
 * in-memory rate limiter, timing-safe comparisons, and SSRF validation for the stream
 * proxy. Dependency-free on purpose so the security-critical paths stay auditable.
 */
import crypto from 'crypto';
import dns from 'dns/promises';
import http from 'http';
import https from 'https';
import net from 'net';
import type { NextFunction, Request, Response } from 'express';
import { config } from './env';

// --- logging ----------------------------------------------------------------

type Level = 'debug' | 'info' | 'warn' | 'error';

export function log(level: Level, message: string, meta?: Record<string, unknown>): void {
  const line = { t: new Date().toISOString(), level, message, ...(meta ?? {}) };
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(JSON.stringify(line));
}

// --- error responses --------------------------------------------------------

/**
 * Send an error without leaking internals. The real error is always logged server-side;
 * the client only sees it when DEBUG_ERRORS=1.
 */
export function sendError(
  res: Response,
  status: number,
  publicDetail: string,
  error?: unknown,
  meta?: Record<string, unknown>,
): void {
  if (error !== undefined) {
    log('error', publicDetail, {
      status,
      path: res.req?.path,
      err: error instanceof Error ? error.message : String(error),
      ...(meta ?? {}),
    });
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  const detail = config.DEBUG_ERRORS && error instanceof Error ? `${publicDetail}: ${error.message}` : publicDetail;
  res.status(status).json({ success: false, detail });
}

// --- timing-safe compare ----------------------------------------------------

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still compare something of equal length so length is not a timing oracle.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// --- rate limiting ----------------------------------------------------------

interface Window {
  count: number;
  resetAt: number;
}

/** Fixed-window limiter, keyed per caller. In-memory: correct for a single instance. */
export class RateLimiter {
  private readonly hits = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    // Opportunistic cleanup so an unattended process does not grow forever.
    const timer = setInterval(() => this.sweep(), Math.max(windowMs, 60_000));
    timer.unref?.();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, win] of this.hits) {
      if (win.resetAt <= now) this.hits.delete(key);
    }
  }

  /** Returns true when the caller is over the limit; also surfaces retry-after. */
  check(key: string): { limited: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const existing = this.hits.get(key);
    if (!existing || existing.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { limited: false, retryAfterSeconds: 0 };
    }
    existing.count += 1;
    if (existing.count > this.limit) {
      return { limited: true, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
    }
    return { limited: false, retryAfterSeconds: 0 };
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

export function clientIp(req: Request): string {
  // Only meaningful when the app is actually behind a proxy; falls back to the socket.
  return (req.ip || req.socket.remoteAddress || 'unknown').replace(/^::ffff:/, '');
}

// --- auth token extraction --------------------------------------------------

/**
 * Accepts `Authorization: Bearer <jwt>` or `?t=<jwt>` (the latter is required because
 * hls.js and <video> cannot set headers).
 */
export function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const value = header.slice('Bearer '.length).trim();
    if (value) return value;
  }
  const query = req.query.t;
  const token = Array.isArray(query) ? query[0] : query;
  return typeof token === 'string' && token ? token : undefined;
}

// --- SSRF protection --------------------------------------------------------

/**
 * Expand an IPv6 address into its eight 16-bit groups, or null if it cannot be parsed.
 * Handles the compressed (`::`) form and an embedded dotted-quad tail.
 */
function ipv6Groups(raw: string): number[] | null {
  let addr = raw.toLowerCase();
  const zone = addr.indexOf('%');
  if (zone !== -1) addr = addr.slice(0, zone);

  let tail: number[] = [];
  const dotted = addr.match(/^(.*):(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) {
    const octets = dotted[2].split('.').map((o) => Number.parseInt(o, 10));
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
    addr = dotted[1];
  }

  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];
    for (const group of part.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(Number.parseInt(group, 16));
    }
    return out;
  };
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !rest) return null;

  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...new Array(fill).fill(0), ...rest, ...tail];
  } else {
    groups = [...head, ...tail];
  }
  return groups.length === 8 ? groups : null;
}

/**
 * Classify an IPv6 address from its groups. IPv4-mapped and IPv4-compatible addresses are
 * re-tested as IPv4, which is the case the previous string-matching version missed:
 * `::ffff:7f00:1` is 127.0.0.1 in hex and reached loopback unguarded, and because an IP
 * literal skips DNS the connect-time guard never saw it either.
 */
function ipv6IsPrivate(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const v4 = (hi: number, lo: number): string =>
    `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;

  // ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible), :: and ::1
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    return isPrivateAddress(v4(g6, g7));
  }
  // Any remaining address inside ::/96 is reserved space.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return true;
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10 (not just fe80)
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g0 & 0xff00) === 0xff00) return true; // multicast ff00::/8
  if (g0 === 0x2002) return isPrivateAddress(v4(g1, g2)); // 6to4 embeds IPv4
  if (g0 === 0x2001 && g1 === 0x0000) return true; // Teredo 2001:0000::/32
  return false;
}

/** True for loopback, link-local, private, CGNAT, multicast and reserved ranges. */
export function isPrivateAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map((p) => Number.parseInt(p, 10));
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true; // 192.0.0/24, 192.0.2/24
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }
  if (version === 6) {
    const groups = ipv6Groups(ip);
    if (!groups) return true; // unparseable: refuse rather than assume it is public
    return ipv6IsPrivate(groups);
  }
  return true; // not an IP at all: refuse
}

/**
 * Host allowlist check. An EMPTY allowlist means "any public host" — this app exists to
 * fetch arbitrary third-party media URLs, so restricting to a fixed list would break
 * playback whenever a scraper returns a new CDN. Set PROXY_ALLOWED_HOSTS to tighten it.
 */
export function hostAllowed(hostname: string, allowlist: string[]): boolean {
  if (!allowlist.length) return true;
  const host = hostname.toLowerCase();
  return allowlist.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return '<unparseable>';
  }
}

/**
 * Agents whose DNS resolution refuses to connect to a private address. This is the real
 * SSRF enforcement: a pre-flight check alone leaves a TOCTOU window, because the client
 * resolves the name a second time when it connects (and again on every redirect). With a
 * guarded lookup, the address that is actually dialled is the one we validated.
 */
function guardedLookup(
  hostname: string,
  options: { all?: boolean },
  callback: (err: Error | null, address?: string | Array<{ address: string; family: number }>, family?: number) => void,
): void {
  dns.lookup(hostname, { all: true })
    .then((records) => {
      const allowed = records.filter((r) => !isPrivateAddress(r.address));
      if (!allowed.length) {
        callback(new Error(`Blocked: ${hostname} resolves only to non-public addresses.`));
        return;
      }
      // Node's happy-eyeballs path (autoSelectFamily, on by default since v20) asks for
      // every address and expects an array back; the classic path wants a scalar pair.
      if (options?.all) {
        callback(null, allowed);
        return;
      }
      callback(null, allowed[0].address, allowed[0].family);
    })
    .catch((err: Error) => callback(err));
}

export function createGuardedAgents(): { httpAgent: http.Agent; httpsAgent: https.Agent } {
  // Bounded sockets: the defaults are Infinity, so the proxy would happily open as many
  // upstream connections as callers request.
  const options = {
    lookup: guardedLookup as never,
    keepAlive: true,
    maxSockets: 32,
    maxTotalSockets: 64,
    timeout: 30_000,
  };
  return {
    httpAgent: new http.Agent(options),
    httpsAgent: new https.Agent(options),
  };
}

export interface UrlCheck {
  ok: boolean;
  reason?: string;
  addresses?: string[];
}

/**
 * Validate an outbound target: http(s) only, resolvable, and every resolved address must
 * be public. Returning the resolved addresses lets the caller pin the connection and
 * avoids the DNS-rebinding gap that a pre-flight check alone leaves open.
 */
export async function assertPublicHttpUrl(raw: string, allowlist: string[]): Promise<UrlCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'Malformed URL.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http(s) URLs are supported.' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'Credentials in the URL are not allowed.' };
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostAllowed(hostname, allowlist)) {
    return { ok: false, reason: 'Host is not in PROXY_ALLOWED_HOSTS.' };
  }

  // A literal IP host must itself be public.
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) return { ok: false, reason: 'Target address is not public.' };
    return { ok: true, addresses: [hostname] };
  }

  let records: { address: string }[];
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    return { ok: false, reason: 'Host could not be resolved.' };
  }
  if (!records.length) return { ok: false, reason: 'Host did not resolve.' };
  for (const record of records) {
    if (isPrivateAddress(record.address)) {
      return { ok: false, reason: 'Host resolves to a non-public address.' };
    }
  }
  return { ok: true, addresses: records.map((r) => r.address) };
}

// --- security headers -------------------------------------------------------

/**
 * Sets conservative security headers. No CSP by default: this app plays third-party HLS
 * and embeds remote subtitles, and a wrong CSP silently breaks playback. Set
 * CSP_POLICY to opt in once you have tuned it against your media sources.
 */
export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  // Only meaningful over TLS, and actively harmful to a host with plain-HTTP siblings,
  // so it follows the production default and can be overridden with HSTS=0/1.
  if (config.HSTS) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (config.CSP_POLICY) res.setHeader('Content-Security-Policy', config.CSP_POLICY);
  next();
}
