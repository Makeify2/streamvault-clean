/**
 * Central, validated configuration.
 *
 * Why this exists: the server previously fell back to hardcoded credentials when the
 * environment was incomplete (`JWT_SECRET || 'super_secret_jwt_key_change_me'`,
 * `APP_PASSWORD || 'streamsecret'`), so a deployment missing those variables silently
 * ran with a publicly known signing key and password. Anything that must not have a
 * safe default is validated here, once, at startup.
 *
 * The dotenv import below must stay first and must live here rather than in index.ts:
 * this module reads process.env at import time, so loading has to happen before the
 * first read. Without it the process ignored backend/.env entirely, which meant the
 * generated JWT_SECRET and ALLOW_NO_AUTH were ignored and auth ran disabled.
 */
import 'dotenv/config';
import crypto from 'crypto';

const truthy = (v: string | undefined): boolean =>
  v === '1' || (v ?? '').toLowerCase() === 'true';

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

/** Values that look like secrets but are not: treat them as absent. */
const PLACEHOLDER_SECRETS = new Set([
  'super_secret_jwt_key_change_me',
  'streamsecret',
  'change-me',
  'changeme',
  'secret',
  'your_jwt_secret',
  'your-secret-here',
]);

function fatal(message: string): never {
  console.error(`[config] FATAL: ${message}`);
  process.exit(1);
}

// --- JWT secret -------------------------------------------------------------
// Required in production. In development a random per-process secret is generated so a
// bare checkout still runs, but sessions intentionally do not survive a restart.
let JWT_SECRET = (process.env.JWT_SECRET || '').trim();
if (!JWT_SECRET || PLACEHOLDER_SECRETS.has(JWT_SECRET.toLowerCase())) {
  if (isProd) {
    fatal(
      'JWT_SECRET is missing or still a placeholder value. Generate one with\n' +
        "    openssl rand -hex 32\n" +
        'and set it in backend/.env before starting in production.',
    );
  }
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn(
    '[config] JWT_SECRET was not set — generated a random one for this process. ' +
      'Existing sessions will be invalidated on restart.',
  );
}
if (isProd && JWT_SECRET.length < 32) {
  fatal(`JWT_SECRET is too short (${JWT_SECRET.length} chars); use at least 32.`);
}

// --- App password / auth ----------------------------------------------------
// Auth is disabled only when APP_PASSWORD is unset or explicitly 'none'. In production
// that must be an intentional, documented choice.
const APP_PASSWORD = (process.env.APP_PASSWORD || '').trim();
const authDisabled = !APP_PASSWORD || APP_PASSWORD === 'none';
const allowNoAuth = truthy(process.env.ALLOW_NO_AUTH);

if (authDisabled) {
  if (isProd && !allowNoAuth) {
    fatal(
      'Authentication is disabled (APP_PASSWORD unset or "none") while NODE_ENV=production.\n' +
        'Either set APP_PASSWORD, or set ALLOW_NO_AUTH=1 to acknowledge that every API route,\n' +
        'including the stream proxy, is open to anyone who can reach this server.',
    );
  }
  console.warn(
    '[config] Authentication is DISABLED (APP_PASSWORD unset or "none"). ' +
      'Every API route is open. Intended for local use only.',
  );
}

// --- CORS -------------------------------------------------------------------
// No wildcard by default. Same-origin (the bundled frontend) needs no CORS at all, so an
// unset ALLOWED_ORIGIN means "serve no cross-origin headers" in production and "allow
// anything" in development where the Vite dev server runs on another port.
const rawOrigins = (process.env.ALLOWED_ORIGIN || '').trim();
const ALLOWED_ORIGINS = rawOrigins
  ? rawOrigins.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

// `ALLOWED_ORIGIN=*` is a trap: the cors middleware only reflects a literal `*` origin, so
// the value silently produced no CORS headers at all. Treat it as "unset" and say so.
const originWasWildcard = ALLOWED_ORIGINS.includes('*');
if (originWasWildcard) {
  console.warn(
    '[config] ALLOWED_ORIGIN=* does not enable a wildcard (the cors middleware will not\n' +
      'reflect it). Listing your origin explicitly, or leaving it empty for same-origin use.',
  );
  ALLOWED_ORIGINS.length = 0;
}

const corsOrigin: string | string[] | boolean = ALLOWED_ORIGINS.length
  ? ALLOWED_ORIGINS
  : !isProd;

if (isProd && !ALLOWED_ORIGINS.length) {
  console.warn(
    '[config] ALLOWED_ORIGIN is not set — no cross-origin requests will be allowed. ' +
      'Set it to your frontend origin if it is served from a different host.',
  );
}

// --- Stream proxy allowlist -------------------------------------------------
// /api/proxy fetches URLs on the server's behalf, which is an SSRF surface. Bad addresses
// (loopback, private, link-local, metadata) are always refused; this allowlist is an
// OPTIONAL extra restriction. Empty means "any public host", because the app exists to
// fetch arbitrary third-party media URLs.
const PROXY_ALLOWED_HOSTS = (process.env.PROXY_ALLOWED_HOSTS || '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

// --- Misc -------------------------------------------------------------------
const positiveInt = (raw: string | undefined, fallback: number): number => {
  const n = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Express `trust proxy` value. Parsed rather than passed through as a raw string:
 * `proxy-addr` throws `TypeError: invalid IP address: true` on the literal string 'true',
 * which crashed the process at module load, and the bare string '1' means
 * "trust the 0.0.0.0/0.0.0.0/1 range" rather than "trust one hop".
 *
 * Default 'loopback' suits the documented nginx deployment: forwarded headers are trusted
 * only from the local proxy, so req.ip is the real client, while a remote caller cannot
 * forge X-Forwarded-For to bypass rate limiting.
 */
function parseTrustProxy(raw: string | undefined): boolean | number | string {
  const value = (raw ?? '').trim();
  if (!value) return 'loopback';
  const lower = value.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value; // an IP, a CIDR list, or a named range such as 'loopback'
}

export const config = {
  env,
  isProd,
  PORT: positiveInt(process.env.PORT, 5000),
  WEBHOOK_PORT: positiveInt(process.env.WEBHOOK_PORT, 9000),
  JWT_SECRET,
  APP_PASSWORD,
  authDisabled,
  allowNoAuth,
  ALLOWED_ORIGINS,
  corsOrigin,
  /**
   * Express `trust proxy` setting. Defaults to 'loopback': this app is deployed behind
   * nginx on the same host, so trusting forwarded headers from loopback makes req.ip the
   * real client (correct rate-limit keys) without letting a remote caller spoof
   * X-Forwarded-For. Accepts true/false, a hop count, an IP/CIDR list or a named range.
   */
  TRUST_PROXY: parseTrustProxy(process.env.TRUST_PROXY),
  /** Send HSTS. On by default in production only, since it is wrong for plain-HTTP hosts. */
  HSTS: process.env.HSTS ? truthy(process.env.HSTS) : isProd,
  /** Optional Content-Security-Policy header. Unset by default (it can break playback). */
  CSP_POLICY: (process.env.CSP_POLICY || '').trim() || undefined,
  PROXY_ALLOWED_HOSTS,
  DEBUG_ERRORS: truthy(process.env.DEBUG_ERRORS),
  HLS_CACHE_DIR: process.env.HLS_CACHE_DIR || '/tmp/sv-cache',
  LOCAL_MEDIA_DIR: process.env.LOCAL_MEDIA_DIR || '/root/streamvault-local',
  /** Cap on how much of a proxied response we buffer when rewriting a playlist. */
  PROXY_MAX_BYTES: positiveInt(process.env.PROXY_MAX_BYTES, 8 * 1024 * 1024),
  /** Max concurrent ffmpeg/ffprobe children before new stream requests are refused. */
  MAX_FFMPEG_PROCS: positiveInt(process.env.MAX_FFMPEG_PROCS, 8),
} as const;

export type Config = typeof config;
