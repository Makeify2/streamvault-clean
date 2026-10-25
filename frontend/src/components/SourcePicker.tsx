import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';
import { X, Loader2, CheckCircle2, XCircle, Play, Clock } from 'lucide-react';

export interface ScrapeRequest {
  tmdbId: number;
  type: 'movie' | 'tv';
  title: string;
  year?: number | string;
  season?: number;
  episode?: number;
}

export interface ScrapeSource {
  sourceId: string;
  name?: string;
  /** Backend sends `kind`; kept as `type` for backward compatibility. */
  kind?: 'stream' | 'torrent' | 'torbox';
  type?: 'stream' | 'torrent' | 'torbox';
  quality?: string;
  url?: string;
  embed?: boolean;
  torrentId?: number;
  fileId?: number;
  magnet?: string;
  hash?: string;
  isCached?: boolean;
  size?: number;
  message?: string;
}

interface SourceStatus {
  sourceId: string;
  status: 'searching' | 'found' | 'failed';
  quality?: string;
  message?: string;
  result?: ScrapeSource;
}

const KNOWN_SOURCES: { id: string; name: string; type: ScrapeSource['type'] }[] = [
  { id: 'vidsrc', name: 'VidSrc', type: 'stream' },
  { id: '2embed', name: '2Embed', type: 'stream' },
  { id: 'superembed', name: 'SuperEmbed', type: 'stream' },
  { id: 'vidlink', name: 'VidLink', type: 'stream' },
  { id: 'vidking', name: 'VidKing', type: 'stream' },
  { id: 'torbox', name: 'TorBox', type: 'torbox' },
  { id: '1337x', name: '1337x', type: 'torrent' },
  { id: 'yts', name: 'YTS', type: 'torrent' },
  { id: 'tgx', name: 'TorrentGalaxy', type: 'torrent' },
];

interface SourcePickerProps {
  request: ScrapeRequest;
  onPick: (source: ScrapeSource) => void;
  onCancel: () => void;
  timeoutMs?: number;
}

/**
 * Live source picker: opens a POST /api/scrape SSE stream, shows each source's
 * status as it resolves, and lets the user click a working source to play.
 */
export const SourcePicker: React.FC<SourcePickerProps> = ({ request, onPick, onCancel, timeoutMs = 10000 }) => {
  const { token } = useAuth();
  const [statuses, setStatuses] = useState<Record<string, SourceStatus>>({});
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    let finished = false;

    const finish = (withTimeout: boolean) => {
      if (finished) return;
      finished = true;
      controller.abort();
      if (withTimeout) setTimedOut(true);
      setStatuses(prev => {
        const next = { ...prev };
        Object.entries(next).forEach(([id, st]) => {
          if (st.status === 'searching') {
            next[id] = {
              ...st,
              status: 'failed',
              message: withTimeout ? 'Timed out' : 'No source found',
            };
          }
        });
        return next;
      });
    };

    const timer = window.setTimeout(() => finish(true), timeoutMs);

    const parseBlock = (block: string) => {
      const lines = block.split('\n');
      const eventLine = lines.find(l => l.startsWith('event:'));
      const dataLine = lines.find(l => l.startsWith('data:'));
      if (!dataLine) return;
      let payload: any;
      try {
        payload = JSON.parse(dataLine.slice(5).trim());
      } catch {
        return;
      }
      const ev = eventLine ? eventLine.slice(6).trim() : 'status';
      if (ev === 'complete') {
        const sources: ScrapeSource[] = payload.sources ?? [];
        setComplete(true);
        setStatuses(prev => {
          const next = { ...prev };
          sources.forEach(s => {
            next[s.sourceId] = {
              sourceId: s.sourceId,
              status: 'found',
              quality: s.quality,
              message: `${s.quality ?? ''} ${s.isCached ? '· cached' : ''}`.trim() || 'Source found',
              result: s,
            };
          });
          return next;
        });
        window.clearTimeout(timer);
        return;
      }
      const st = payload as SourceStatus;
      if (st?.sourceId) {
        setStatuses(prev => {
          const next = { ...prev };
          if (st.status === 'found') {
            next[st.sourceId] = {
              ...st,
              result: st.result ?? prev[st.sourceId]?.result,
              message: st.message ?? `${st.quality ?? ''} found`.trim(),
            };
          } else {
            next[st.sourceId] = st;
          }
          return next;
        });
      }
    };

    (async () => {
      try {
        const res = await fetch(apiUrl('/api/scrape'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`Scrape service unavailable (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            parseBlock(block);
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          setError(err?.message || 'Failed to reach the source service.');
        }
      } finally {
        window.clearTimeout(timer);
      }
    })();

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, request.tmdbId, request.type, request.title, timeoutMs]);

  const hasFound = Object.values(statuses).some(s => s.status === 'found');

  return (
    <div className="source-picker-backdrop">
      <div className="source-picker glass-panel">
        <div className="source-picker-header">
          <div>
            <h3 className="source-picker-title">Finding Sources</h3>
            <p className="source-picker-subtitle">
              {request.title}
              {request.season != null && request.episode != null
                ? ` · S${request.season}E${request.episode}`
                : ''}
            </p>
          </div>
          <button className="source-picker-close" onClick={onCancel} title="Cancel" aria-label="Cancel">
            <X size={18} />
          </button>
        </div>

        {error && !complete && (
          <div className="source-picker-error">
            <XCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div className="source-picker-list">
          {KNOWN_SOURCES.map(s => {
            const st = statuses[s.id];
            const state = st?.status ?? 'searching';
            return (
              <div key={s.id} className={`source-row source-row-${state}`}>
                <div className="source-row-main">
                  <span className="source-row-name">{s.name}</span>
                  {st?.quality && <span className="source-row-quality">{st.quality}</span>}
                  <span className="source-row-message">
                    {state === 'searching'
                      ? st?.message || (s.type === 'torbox' ? 'Checking cache...' : 'Searching...')
                      : st?.message || (state === 'found' ? 'Source found' : 'No source')}
                  </span>
                </div>
                <div className="source-row-side">
                  {state === 'searching' && <Loader2 size={16} className="spinner" />}
                  {state === 'failed' && <XCircle size={16} color="var(--error)" />}
                  {state === 'found' && (
                    <>
                      <CheckCircle2 size={16} color="var(--success)" />
                      {st?.result && (
                        <button
                          className="glass-button source-row-play"
                          onClick={() => st.result && onPick(st.result)}
                        >
                          <Play size={13} fill="currentColor" /> Play
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="source-picker-footer">
          {timedOut && !complete && !hasFound && (
            <span className="source-picker-hint"><Clock size={13} /> No sources found in time</span>
          )}
          {complete && !hasFound && <span className="source-picker-hint">No working sources found</span>}
          <button className="glass-button" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
};
