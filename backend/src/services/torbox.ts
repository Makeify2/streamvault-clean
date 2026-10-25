import axios from 'axios';

const TORBOX_BASE_URL = 'https://api.torbox.app/v1/api';

const getHeaders = () => {
  const apiKey = process.env.TORBOX_API_KEY;
  if (!apiKey || apiKey === 'your_torbox_api_key_here') {
    throw new Error('TorBox API Key is not configured in .env file.');
  }
  return {
    Authorization: `Bearer ${apiKey}`
  };
};

export interface TorBoxFile {
  id: number;
  name: string;
  size: number;
}

export interface TorBoxTorrent {
  id: number;
  name: string;
  hash: string;
  size: number;
  /** Normalized to 0-100 (TorBox returns 0-1). */
  progress: number;
  download_present: boolean;
  download_finished: boolean;
  download_speed: number;
  status: string;
  /** True when the content is fully cached/downloaded and streamable. */
  ready: boolean;
  files: TorBoxFile[];
}

// TorBox statuses that mean the content is fully available on their CDN
const READY_STATUSES = ['completed', 'cached', 'uploading', 'uploading (no peers)', 'seeding', 'stalled (no seeds)'];

/** TorBox reports progress as a 0-1 float; normalize to a 0-100 percentage. */
function normalizeProgress(progress: unknown): number {
  const p = typeof progress === 'number' && !isNaN(progress) ? progress : 0;
  const pct = p <= 1 ? p * 100 : p;
  return Math.min(100, Math.round(pct * 10) / 10);
}

function isReady(t: any, progress: number): boolean {
  return !!(
    t.download_finished ||
    t.download_present ||
    progress >= 100 ||
    READY_STATUSES.includes(String(t.status || '').toLowerCase())
  );
}

/**
 * Fetches the user's active torrents list from TorBox.
 */
export async function listTorrents(): Promise<TorBoxTorrent[]> {
  try {
    const response = await axios.get(`${TORBOX_BASE_URL}/torrents/mylist`, {
      headers: getHeaders()
    });

    if (response.data && response.data.success) {
      const raw: any[] = response.data.data || [];
      return raw.map(t => {
        const progress = normalizeProgress(t.progress);
        return {
          ...t,
          progress: isReady(t, progress) ? 100 : progress,
          ready: isReady(t, progress)
        };
      });
    }
    throw new Error(response.data?.detail || 'Failed to retrieve torrents from TorBox.');
  } catch (error: any) {
    console.error('TorBox listTorrents error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.detail || error.message || 'TorBox connection failed.');
  }
}

export interface TorBoxSearchResult {
  hash: string;
  name: string;
  size: number;
  seeds: number;
  peers: number;
  owned?: boolean;
}

export async function searchTorrents(query: string, limit = 15): Promise<TorBoxSearchResult[]> {
  try {
    const response = await axios.get(`${TORBOX_BASE_URL}/torrents/search`, {
      params: { query, limit },
      headers: getHeaders()
    });
    if (response.data && response.data.success) {
      return response.data.data || [];
    }
    throw new Error(response.data?.detail || 'Torrent search failed.');
  } catch (error: any) {
    console.error('TorBox searchTorrents error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.detail || error.message || 'TorBox search failed.');
  }
}

export async function addTorrentByMagnet(magnet: string): Promise<{ id: number; name: string }> {
  try {
    const params = new URLSearchParams();
    params.append('magnet', magnet);
    const response = await axios.post(`${TORBOX_BASE_URL}/torrents/createtorrent`, params, {
      headers: {
        ...getHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    if (response.data && response.data.success) {
      return response.data.data;
    }
    throw new Error(response.data?.detail || 'Failed to add torrent to TorBox.');
  } catch (error: any) {
    console.error('TorBox addTorrent error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.detail || error.message || 'Failed to add torrent to TorBox.');
  }
}

/**
 * Requests a direct CDN streaming link for a specific file within a torrent.
 */
export async function getDownloadLink(torrentId: number | string, fileId: number | string): Promise<string> {
  try {
    const apiKey = process.env.TORBOX_API_KEY;
    const response = await axios.get(`${TORBOX_BASE_URL}/torrents/requestdl`, {
      params: {
        token: apiKey,
        torrent_id: torrentId,
        file_id: fileId,
        redirect: false
      },
      headers: getHeaders()
    });
    
    if (response.data && response.data.success) {
      // The direct streaming link is in response.data.data
      return response.data.data;
    }
    throw new Error(response.data?.detail || 'Failed to request streaming link.');
  } catch (error: any) {
    console.error('TorBox getDownloadLink error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.detail || error.message || 'Failed to retrieve streaming link.');
  }
}
