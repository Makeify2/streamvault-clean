import { listTorrents, searchTorrents } from '../torbox';
import type { TorBoxTorrent } from '../torbox';
import type { ScrapeRequest, ScrapeResult, SourceScraper, ScrapeStatusEvent } from './types';

const VIDEO_EXTS = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'flv'];

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function guessQuality(name: string): string | undefined {
  const n = name.toLowerCase();
  if (/2160p|4k|uhd/.test(n)) return '4K';
  if (/1080p/.test(n)) return '1080p';
  if (/720p/.test(n)) return '720p';
  return undefined;
}

function isVideoFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTS.includes(ext);
}

function bestVideoFile(t: TorBoxTorrent): { id: number; name: string } | null {
  const videos = (t.files || []).filter(f => isVideoFile(f.name));
  if (videos.length === 0) return null;
  const best = [...videos].sort((a, b) => b.size - a.size)[0];
  return { id: best.id, name: best.name };
}

function titleMatches(req: ScrapeRequest, candidateName: string): boolean {
  const needle = normalizeTitle(req.title);
  const hay = normalizeTitle(candidateName);
  if (!needle || !hay) return false;
  if (hay === needle) return true;
  if (hay.includes(needle) || needle.includes(hay)) return true;
  // Token overlap: at least half of the title tokens appear in the candidate.
  const tokens = needle.split(' ').filter(t => t.length > 2);
  if (tokens.length === 0) return false;
  const hits = tokens.filter(t => hay.includes(t)).length;
  return hits / tokens.length >= 0.5;
}

function seasonEpisodeMatch(req: ScrapeRequest, name: string): boolean {
  if (req.type !== 'tv' || req.season === undefined || req.episode === undefined) return true;
  const n = name.toLowerCase();
  const sxe = n.match(/s(\d{1,2})[.\s_]*e(\d{1,3})/);
  if (sxe) {
    return Number(sxe[1]) === req.season && Number(sxe[2]) === req.episode;
  }
  return true; // no explicit tag: don't disqualify
}

function sortCandidates(a: TorBoxTorrent, b: TorBoxTorrent): number {
  // Ready first, then higher quality, then larger size.
  const qualityRank = (t: TorBoxTorrent) =>
    guessQuality(t.name) === '4K' ? 3 : guessQuality(t.name) === '1080p' ? 2 : guessQuality(t.name) === '720p' ? 1 : 0;
  if (a.ready !== b.ready) return a.ready ? -1 : 1;
  if (qualityRank(a) !== qualityRank(b)) return qualityRank(b) - qualityRank(a);
  return (b.size || 0) - (a.size || 0);
}

/**
 * TorBox scraper:
 *  1. Looks for a ready torrent already in the user's library (title + year match).
 *  2. Falls back to TorBox's torrent index search for cached candidates.
 */
export class TorboxScraper implements SourceScraper {
  id = 'torbox';
  name = 'TorBox';
  kind = 'torbox' as const;

  async scrape(req: ScrapeRequest, emit: (event: ScrapeStatusEvent) => void): Promise<ScrapeResult | null> {
    emit({ sourceId: this.id, name: this.name, status: 'searching', message: 'Checking TorBox cache...' });

    const query = [req.title, req.year].filter(Boolean).join(' ');

    // 1) Already in the account and ready to play.
    try {
      const torrents = await listTorrents();
      const ready = torrents
        .filter(t => t.ready && titleMatches(req, t.name) && seasonEpisodeMatch(req, t.name))
        .sort(sortCandidates);
      const pick = ready[0];
      if (pick) {
        const file = bestVideoFile(pick);
        if (file) {
          return {
            sourceId: this.id,
            name: this.name,
            kind: 'torbox',
            quality: guessQuality(pick.name),
            torrentId: pick.id,
            fileId: file.id,
            isCached: true,
            size: pick.size,
            message: `Cached in your TorBox library (${file.name})`,
          };
        }
      }
    } catch (e: any) {
      console.error('[TorBox scraper] listTorrents failed:', e.message);
    }

    // 2) Search TorBox's public index for a cached/available torrent.
    try {
      const results = await searchTorrents(query, 15);
      const scored = results
        .filter(r => titleMatches(req, r.name))
        .sort((a, b) => {
          const yearA = a.name.match(/\(?(\d{4})\)?/)?.[1];
          const yearB = b.name.match(/\(?(\d{4})\)?/)?.[1];
          const ya = req.year !== undefined && yearA === String(req.year);
          const yb = req.year !== undefined && yearB === String(req.year);
          if (ya !== yb) return ya ? -1 : 1;
          return (b.seeds || 0) - (a.seeds || 0);
        });
      const best = scored[0];
      if (best) {
        const magnet = `magnet:?xt=urn:btih:${best.hash}&dn=${encodeURIComponent(best.name)}&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Fopen.demonii.com%3A1337%2Fannounce`;
        return {
          sourceId: this.id,
          name: this.name,
          kind: 'torbox',
          quality: guessQuality(best.name),
          magnet,
          hash: best.hash,
          isCached: false,
          size: best.size,
          message: `Found on TorBox index — add to cache & play (${best.name})`,
        };
      }
    } catch (e: any) {
      console.error('[TorBox scraper] searchTorrents failed:', e.message);
    }

    emit({ sourceId: this.id, name: this.name, status: 'failed', message: 'Not cached on TorBox' });
    return null;
  }
}
