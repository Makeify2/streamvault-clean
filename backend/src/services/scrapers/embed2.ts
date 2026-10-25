import type { ScrapeRequest, ScrapeResult, SourceScraper, ScrapeStatusEvent } from './types';
import { extractM3u8, fetchText, viaProxy, absolutize } from './helpers';

const BASES = ['https://www.2embed.cc', 'https://multiembed.mov'];

function embedPath(req: ScrapeRequest): string {
  // TV requests must never fall back to a movie URL (TMDb ids are shared
  // between movies and shows, e.g. 615 = Futurama or The Passion of the Christ).
  if (req.type === 'tv') {
    const sxe = req.season !== undefined && req.episode !== undefined ? `&s=${req.season}&e=${req.episode}` : '';
    return `/embedtv/${req.tmdbId}${sxe}`;
  }
  return `/embed/${req.tmdbId}`;
}

/**
 * 2Embed / MultiEmbed scraper. Tries both bases; prefers a resolved HLS
 * playlist, otherwise offers the deterministic embed URL (directly
 * iframe-able in the browser - no proxy required).
 */
export class Embed2Scraper implements SourceScraper {
  id = '2embed';
  name = '2Embed';
  kind = 'stream' as const;

  async scrape(req: ScrapeRequest, emit: (event: ScrapeStatusEvent) => void): Promise<ScrapeResult | null> {
    emit({ sourceId: this.id, name: this.name, status: 'searching', message: 'Checking 2Embed...' });

    let firstEmbed: string | null = null;
    for (const base of BASES) {
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

    emit({ sourceId: this.id, name: this.name, status: 'failed', message: 'No source on 2Embed' });
    return null;
  }
}
