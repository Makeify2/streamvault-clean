import type { Request, Response } from 'express';
import { getScrapers } from './scrapers';
import type { ScrapeRequest, ScrapeResult, ScrapeStatusEvent } from './scrapers/types';

const OVERALL_TIMEOUT_MS = 15000;
const SOURCE_TIMEOUT_MS = 9000;

function sendSSE(res: Response, event: string, data: unknown): void {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Client may have disconnected mid-write; never let this crash the process.
  }
}

/**
 * POST /api/scrape — runs every configured scraper in parallel and streams
 * per-source status updates as Server-Sent Events:
 *
 *   event: start     { tmdbId, type, title }
 *   event: status    { sourceId, name, status: searching|found|failed, ... }
 *   event: complete  { sources: ScrapeResult[] }
 *   event: ping      { t } (keep-alive while scrapers are still running)
 */
export async function handleScrape(req: Request, res: Response): Promise<void> {
  const body = (req.body || {}) as Partial<ScrapeRequest>;
  const tmdbId = Number(body.tmdbId);
  const type: 'movie' | 'tv' = body.type === 'tv' ? 'tv' : 'movie';
  const title = String(body.title || '').trim();

  if (!Number.isFinite(tmdbId) || tmdbId <= 0 || !title) {
    res.status(400).json({ success: false, detail: 'tmdbId and title are required.' });
    return;
  }

  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) || req.protocol;

  const scrapeReq: ScrapeRequest = {
    tmdbId,
    type,
    title,
    year: body.year,
    season: body.season,
    episode: body.episode,
    proxyBase: `${proto}://${req.get('host') || ''}`,
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  sendSSE(res, 'start', { tmdbId, type, title });
  console.error(`[scrape] start for "${title}" (${tmdbId})`);

  const scrapers = getScrapers();
  const results: ScrapeResult[] = [];
  let completed = 0;
  let finished = false;

  const emitStatus = (event: ScrapeStatusEvent): void => {
    if (finished) return;
    sendSSE(res, 'status', event);
  };

  const maybeFinish = (): void => {
    if (finished || completed < scrapers.length) return;
    finished = true;
    console.error(`[scrape] complete with ${results.length} results`);
    sendSSE(res, 'complete', { sources: results });
    try {
      res.end();
    } catch {
      // Already ended by a disconnect; nothing else to do.
    }
  };

  const runOne = async (index: number): Promise<void> => {
    const scraper = scrapers[index];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      emitStatus({
        sourceId: scraper.id,
        name: scraper.name,
        status: 'failed',
        message: 'Timed out',
      });
      console.error(`[scrape] source ${scraper.id} timed out`);
      completed += 1;
      maybeFinish();
    }, SOURCE_TIMEOUT_MS);

    let result: ScrapeResult | null = null;
    try {
      result = await scraper.scrape(scrapeReq, ev => emitStatus(ev));
    } catch (e: any) {
      if (!settled) {
        emitStatus({
          sourceId: scraper.id,
          name: scraper.name,
          status: 'failed',
          message: e?.message || 'Scrape error',
        });
      }
    } finally {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (result) {
          results.push(result);
          console.error(`[scrape] source ${scraper.id} found`);
          emitStatus({
            sourceId: scraper.id,
            name: scraper.name,
            status: 'found',
            quality: result.quality,
            message: result.message || 'Source found',
            result,
          });
        }
        completed += 1;
        maybeFinish();
      }
    }
  };

  const ping = setInterval(() => sendSSE(res, 'ping', { t: Date.now() }), 10000);
  const overall = setTimeout(() => {
    clearInterval(ping);
    if (!finished) {
      finished = true;
      console.error('[scrape] overall timeout reached');
      sendSSE(res, 'complete', { sources: results });
      try {
        res.end();
      } catch {
        // ignore
      }
    }
  }, OVERALL_TIMEOUT_MS);

  // Detect real client disconnects. req 'close' fires as soon as the POST body
  // is consumed, so we listen on the response instead and only treat it as a
  // disconnect when the stream wasn't ended by us.
  res.on('close', () => {
    clearTimeout(overall);
    clearInterval(ping);
    if (!finished && !res.writableEnded) {
      console.error('[scrape] client disconnected mid-stream');
      finished = true;
      try {
        res.end();
      } catch {
        // ignore
      }
    }
  });

  for (let i = 0; i < scrapers.length; i++) {
    void runOne(i);
  }
}
