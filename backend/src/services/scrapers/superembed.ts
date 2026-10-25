import type { ScrapeRequest, ScrapeResult, SourceScraper, ScrapeStatusEvent } from './types';
import { extractM3u8, fetchText, viaProxy, absolutize } from './helpers';

function embedUrl(req: ScrapeRequest, base: string): string {
  // TV requests must never fall back to a movie URL (TMDb ids are shared
  // between movies and shows, e.g. 615 = Futurama or The Passion of the Christ).
  if (req.type === 'tv') {
    const sxe = req.season !== undefined && req.episode !== undefined ? `/${req.season}/${req.episode}` : '';
    return `${base}/tv/${req.tmdbId}${sxe}`;
  }
  return `${base}/movie/${req.tmdbId}`;
}

/**
 * SuperEmbed scraper. Tries both hosts; prefers a resolved HLS playlist,
 * otherwise offers the deterministic embed URL (directly iframe-able in the
 * browser - no proxy required).
 */
export class SuperEmbedScraper implements SourceScraper {
  id = 'superembed';
  name = 'SuperEmbed';
  kind = 'stream' as const;

  async scrape(req: ScrapeRequest, emit: (event: ScrapeStatusEvent) => void): Promise<ScrapeResult | null> {
    emit({ sourceId: this.id, name: this.name, status: 'searching', message: 'Checking SuperEmbed...' });

    const bases = ['https://multiembed.mov/', 'https://embed.superembed.stream/'];
    let firstEmbed: string | null = null;
    for (const base of bases) {
      const embed = embedUrl(req, base);
      if (!firstEmbed) firstEmbed = embed;
      const html = await fetchText(embed);
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
        url: embed,
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

    emit({ sourceId: this.id, name: this.name, status: 'failed', message: 'No source on SuperEmbed' });
    return null;
  }
}
