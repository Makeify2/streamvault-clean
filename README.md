# StreamVault

A private streaming front-end for your [TorBox](https://torbox.app) account. It lists your
torrents as a Netflix-style library with TMDb posters and metadata, and streams cached
content straight from the TorBox CDN in the browser.

## Setup

```bash
# Backend (Express, port 5000)
cd backend
cp .env.example .env
openssl rand -hex 32   # paste into JWT_SECRET
npm install
npm run dev

# Frontend (Vite + React, port 5173, proxies /api to the backend)
cd frontend
npm install
npm run dev
```

`JWT_SECRET` is required in production: the server refuses to start with a placeholder or a
secret under 32 characters, and it has no built-in fallback.

Set `APP_PASSWORD=none` to disable login. In production that also requires `ALLOW_NO_AUTH=1`,
which exists purely so that turning auth off is a deliberate act: with auth disabled every
route, including the stream proxy, is open to anyone who can reach the host.

## Features

- **Content discovery** — Cineby-style browse experience at `/`: trending/popular
  hero + rows, movie/TV detail pages with cast and trailers, debounced search,
  and genre browsing. All metadata comes from TMDb through the backend proxy.
- **Library grid** with TMDb posters, ratings, and genres; automatic title parsing handles
  scene releases, anime fansub naming (`[Group] Show - 05`), season packs, and site-prefix junk.
- **Search, filter (Movies / TV / Downloading / Other), and sort** (recently added, title, size).
  Games and software are detected automatically and tucked into the **Other** tab.
- **Cached/downloading status** uses TorBox's `download_present`/`download_finished` flags, so
  instantly-cached torrents show as **Ready** instead of stuck at "1%". The library
  auto-refreshes every 30 s while anything is still downloading.
- **Player**: custom controls, playback speed, buffering indicator, double-click fullscreen,
  volume persistence, and keyboard shortcuts (`Space`/`K` play, `F` fullscreen, `M` mute,
  `←`/`→` seek 10 s, `↑`/`↓` volume).
- **Resume watching**: positions are saved locally; partially-watched titles show a *Resume*
  chip in the library and pick up where you left off (with a Start Over option).
- **Subtitles**: external `.srt`, `.ass`/`.ssa`, and `.vtt` files are converted to WebVTT
  on the fly, matched to the right episode file (including subs in `Subs/` folders), with
  language auto-detection.
- **Audio track switching** via the HTML5 `audioTracks` API where the browser supports it
  (Safari, some Chromium builds); elsewhere the player offers the direct CDN link for
  VLC/MPV, which is also the escape hatch for embedded MKV subs and exotic codecs.
- **Fix Metadata** modal with built-in TMDb search — pick the right match from a result
  list instead of pasting numeric IDs.
- **Multi-source Watch Now** — clicking Watch Now scrapes VidSrc, 2Embed,
  SuperEmbed, your TorBox cache, and public indexers (YTS/1337x/TorrentGalaxy)
  in parallel and streams live status updates over SSE. Pick a working source
  and it plays instantly (embeds via iframe, HLS via hls.js, TorBox via CDN).
  Individual sources can be toggled with `SOURCE_<ID>=0/1` and streaming-server
  requests can be routed through a proxy with `STREAM_PROXY` (see `.env.example`).

## Routes

- `/` — trending/popular discovery home
- `/movie/:id`, `/tv/:id` — detail pages with cast, trailer, episodes
- `/search` — search (URL-synced, movie/TV toggle)
- `/genre/:genreId` — genre browsing with pagination
- `/watch/:type/:id` — source picker + player
- `/library` — the original TorBox library manager
- `/login` — auth

## Notes

- TMDb mappings are cached in `backend/data/mappings.json` for 7 days; failed lookups retry
  after an hour.
- Subtitle routes (`/api/subtitles/...`, `/api/opensubs/...`) ARE authenticated. Browser
  `<track>`/`<video>` elements cannot send headers, so they accept the session token as
  `?t=<jwt>` — the same mechanism `/api/hls` and `/api/ffstream` use. The frontend adds it
  with `withMediaToken()` from `src/lib/api.ts`.

## Production hardening

What the server enforces at startup and on every request:

- **No default credentials.** `JWT_SECRET` is required in production and must be ≥32 chars;
  there is no fallback signing key and no fallback password. Authentication is off only when
  `APP_PASSWORD` is unset or `none` *and* `ALLOW_NO_AUTH=1` acknowledges it.
- **Login is rate limited** (10 attempts / 15 min per IP), compared in constant time, and
  throttled attempts are answered with `429` + `Retry-After`.
- **The stream proxy is guarded.** `/api/proxy` requires a token (unless auth is disabled)
  and validates the target at connect time via a DNS lookup that refuses loopback, private,
  link-local, CGNAT, multicast and cloud-metadata addresses — including on every redirect
  hop, which closes the DNS-rebinding and redirect bypasses a URL-string check left open.
  Playlists are capped by `PROXY_MAX_BYTES` (default 8 MiB). Set `PROXY_ALLOWED_HOSTS` to
  pin the proxy to specific hosts.
- **Media routes require auth:** subtitles, OpenSubtitles downloads and local media, which
  were previously reachable anonymously.
- **Local media cannot escape its root.** The filename is reduced to a basename and the real
  path is required to stay inside `LOCAL_MEDIA_DIR`, so symlinks out of the directory fail.
- **Errors no longer leak internals.** Handlers log the real error server-side and return a
  generic message; `DEBUG_ERRORS=1` restores the detail locally.
- **Security headers** on every response (`nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, COOP, HSTS). CSP is opt-in via `CSP_POLICY`, because this
  app plays third-party HLS and a wrong policy silently breaks playback.
- **Resource limits and clean shutdown.** Encoder processes are tracked and capped by
  `MAX_FFMPEG_PROCS`; `SIGTERM`/`SIGINT` stop the listener and reap ffmpeg children instead
  of orphaning them. `/healthz` is an unauthenticated liveness probe.
- **The deploy webhook fails closed.** `backend/src/webhook.ts` refuses to start without
  `WEBHOOK_SECRET` and verifies `X-Hub-Signature-256` in constant time — previously an
  unset secret meant the signature check was skipped, so any anonymous POST could trigger
  `git pull && npm run build && pm2 restart`.

Verify all of the above against a running server:

```bash
bash backend/scripts/smoke-hardening.sh
```

It launches a production-mode server and asserts the controls (auth, rate limiting, proxy
blocking of loopback/metadata/private/decimal-encoded targets, path traversal, fail-closed
startup paths, clean shutdown, dependency audit) and exits non-zero on any failure.
