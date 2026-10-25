// Shared types for the multi-source scraper system.

export interface ScrapeRequest {
  tmdbId: number;
  type: 'movie' | 'tv';
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  /**
   * Public base URL of the backend (protocol + host) derived from the incoming
   * scrape request. Used to build self-proxied media URLs (`/api/proxy?url=`)
   * so external HLS streams play without a separate proxy service.
   */
  proxyBase?: string;
}

export interface ScrapeResult {
  sourceId: string;
  name: string;
  kind: 'stream' | 'torrent' | 'torbox';
  quality?: string;
  /**
   * HLS master playlist URL. When `embed` is true this is an iframe-embeddable
   * page instead, and the player should render it in an iframe.
   */
  url?: string;
  embed?: boolean;
  /** TorBox torrent id (ready torrents already in the account). */
  torrentId?: number;
  /** TorBox file id (ready torrents already in the account). */
  fileId?: number;
  magnet?: string;
  hash?: string;
  /** True when the content can be played immediately. */
  isCached: boolean;
  size?: number;
  message?: string;
}

export type ScrapeStatus = 'searching' | 'found' | 'failed';

export interface ScrapeStatusEvent {
  sourceId: string;
  name: string;
  status: ScrapeStatus;
  quality?: string;
  message?: string;
  /** Full result payload, included on 'found' events so the UI can offer playback immediately. */
  result?: ScrapeResult;
}

export interface SourceScraper {
  id: string;
  name: string;
  kind: 'stream' | 'torrent' | 'torbox';
  scrape(
    req: ScrapeRequest,
    emit: (event: ScrapeStatusEvent) => void,
  ): Promise<ScrapeResult | null>;
}
