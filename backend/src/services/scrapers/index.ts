import { TorboxScraper } from './torbox';
import { VidsrcScraper } from './vidsrc';
import { Embed2Scraper } from './embed2';
import { SuperEmbedScraper } from './superembed';
import { VidLinkScraper } from './vidlink';
import { VidKingScraper } from './vidking';
import { createIndexerScrapers } from './torrent-indexers';
import type { SourceScraper } from './types';

/**
 * Config-driven source toggles. Every source is enabled by default; disable
 * individual ones with SOURCE_<ID>=0/1 (e.g. SOURCE_VIDSRC=0, SOURCE_TGX=0).
 */
function isEnabled(id: string): boolean {
  const value = process.env[`SOURCE_${id.toUpperCase()}`];
  if (value === undefined || value === '') return true;
  return value === '1' || value.toLowerCase() === 'true';
}

/**
 * Registry of every configured source. Order controls the UI list order.
 * Streaming servers first (instant playback), then TorBox, then indexers.
 */
export function getScrapers(): SourceScraper[] {
  const all: SourceScraper[] = [
    new VidsrcScraper(),
    new Embed2Scraper(),
    new SuperEmbedScraper(),
    new VidLinkScraper(),
    new VidKingScraper(),
    new TorboxScraper(),
    ...createIndexerScrapers(),
  ];
  return all.filter(s => isEnabled(s.id));
}

/** Lightweight source listing for /api/scrape/status and debugging. */
export function listScrapers(): { id: string; name: string; kind: SourceScraper['kind'] }[] {
  return getScrapers().map(s => ({ id: s.id, name: s.name, kind: s.kind }));
}
