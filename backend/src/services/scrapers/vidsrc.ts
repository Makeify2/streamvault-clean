import type { ScrapeRequest, ScrapeResult, SourceScraper, ScrapeStatusEvent } from './types';
import { extractM3u8, fetchText, viaProxy, absolutize } from './helpers';

const MIRRORS = ['https://vsembed.su', 'https://vidsrc.to', 'https://vidsrc2.ru', 'https://vidsrcme.ru'];

function embedPath(req: ScrapeRequest): string {
  // TV requests must never fall back to a movie URL - TMDb ids are shared
  // between movies and shows (e.g. Futurama and The Passion of the Christ
  // are both id 615), so that would play the wrong title.
  if (req.type === 'tv') {
    const sxe = req.season !== undefined && req.episode !== undefined ? `/${req.season}/${req.episode}` : '';
    return `/embed/tv/${req.tmdbId}${sxe}`;
  }
  return `/embed/movie/${req.tmdbId}`;
}

/**
 * VidSrc scraper. Tries several mirrors; attempts to resolve a direct HLS
 * playlist from the embed page and falls back to the embed URL itself.
 */
export class VidsrcScraper implements SourceScraper {
  id = 'vidsrc';
  name = 'VidSrc';
  kind = 'stream' as const;

  async scrape(req: ScrapeRequest, emit: (event: ScrapeStatusEvent) => void): Promise<ScrapeResult | null> {
    emit({ sourceId: this.id, name: this.name, status: 'searching', message: 'Checking VidSrc...' });

    let firstEmbed: string | null = null;
    for (const base of MIRRORS) {
      const embedUrl = `${base}${embedPath(req)}`;
      if (!firstEmbed) firstEmbed = embedUrl;
      const html = await fetchText(embedUrl);
      if (!html) continue;

      const hls = extractM3u8(html);
      if (hls) {
        return {
          sourceId: this.id,
          name: this.name,
          kind: 'stream',
          url: viaProxy(absolutize(base, hls), req),
          isCached: true,
          message: 'HLS stream resolved',
        };
      }

      // The embed URL is the reliable entry point - inner iframes are often
      // referer/cookie-bound and 404 when embedded from another origin.
      return {
        sourceId: this.id,
        name: this.name,
        kind: 'stream',
        url: embedUrl,
        embed: true,
        isCached: true,
        message: 'Embed available',
      };
    }

    // Server-side fetch failed (no proxy / blocked) - the embed URL is still
    // directly iframe-able in the browser, so offer it rather than failing.
    if (firstEmbed) {
      return {
        sourceId: this.id,
        name: this.name,
        kind: 'stream',
        url: firstEmbed,
        embed: true,
        isCached: true,
        message: 'Embed available (direct)',
      };
    }

    emit({ sourceId: this.id, name: this.name, status: 'failed', message: 'No source on VidSrc' });
    return null;
  }
}
