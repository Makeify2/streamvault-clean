// Shared utility functions used across multiple components.

/**
 * Parse season/episode info from a video filename.
 * Handles S01E05, 1x05, anime "- 05" patterns.
 */
export function parseEpisodeFromFile(filename: string): { season: number; episode: number } | null {
  const nameLower = (filename.split('/').pop() || filename).toLowerCase();

  // S01E05, S1E5, s01e05
  const sXXeXX = nameLower.match(/s(\d{1,4})[\s._\-]?e(\d{1,4})/);
  if (sXXeXX) return { season: parseInt(sXXeXX[1], 10), episode: parseInt(sXXeXX[2], 10) };

  // 1x05, 01x05
  const NxNN = nameLower.match(/(\d{1,2})x(\d{1,3})/);
  if (NxNN) return { season: parseInt(NxNN[1], 10), episode: parseInt(NxNN[2], 10) };

  // " - 05" (anime naming)
  const animeEp = nameLower.match(/\s-\s(\d{1,4})(?:\s|$)/);
  if (animeEp) return { season: 1, episode: parseInt(animeEp[1], 10) };

  // Fallback: just "Episode 05" or "Ep 05"
  const genericEp = nameLower.match(/(?:episode|ep)[\s._\-]?(\d{1,4})/);
  if (genericEp) return { season: -1, episode: parseInt(genericEp[1], 10) };

  return null;
}

/**
 * Format bytes into a human-readable string (KB, MB, GB).
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + units[i];
}

/**
 * Format seconds into HH:MM:SS or MM:SS.
 */
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Build a TMDb image URL from a poster/backdrop path.
 * Returns an empty string when no path exists (callers can fall back).
 */
export function tmdbImage(path: string | null | undefined, size = 'w500'): string {
  if (!path) return '';
  return `https://image.tmdb.org/t/p/${size}${path}`;
}
