import { useState, useCallback, useEffect } from 'react';
import { apiUrl } from '../lib/api';

/**
 * Returns the HLS master playlist URL. No fetch needed — the URL is deterministic.
 * Still provides loading/error/retry for compatibility with existing consumers.
 */
export function useStreamUrl(
  torrentId: number | string,
  fileId: number | string,
  token: string | null,
) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // The HLS master playlist URL (deterministic, no server fetch needed)
  const streamUrl = token
    ? apiUrl(`/api/hls/${torrentId}/${fileId}/master.m3u8?t=${encodeURIComponent(token)}`)
    : null;

  // Simulate loading state briefly so the UI has time to initialize
  useEffect(() => {
    if (token) {
      setLoading(false);
    }
  }, [token]);

  const retry = useCallback(() => {
    setError('');
    setLoading(false);
  }, []);

  return {
    streamUrl,
    loading,
    error,
    setError,
    setLoading,
    setStreamUrl: () => {},
    fetchStream: () => {},
    retry,
  } as const;
}
