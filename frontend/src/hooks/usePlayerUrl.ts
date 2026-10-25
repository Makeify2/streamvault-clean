import type { TorrentMetadata } from '../types';

interface PlayerUrls {
  vidking: string | null;
  vidsrc: string | null;
  vidlink: string | null;
}

export function usePlayerUrl(torrentMetadata?: TorrentMetadata): PlayerUrls {
  if (!torrentMetadata?.tmdbId) return { vidking: null, vidsrc: null, vidlink: null };

  const { tmdbId, type, parsed } = torrentMetadata;

  if (type === 'tv' && parsed.season != null && parsed.episode != null) {
    return {
      vidking: `https://www.vidking.net/embed/tv/${tmdbId}/${parsed.season}/${parsed.episode}`,
      vidsrc: `https://vidsrcme.ru/embed/tv/${tmdbId}/${parsed.season}/${parsed.episode}`,
      vidlink: `https://vidlink.pro/tv/${tmdbId}/${parsed.season}/${parsed.episode}?autoplay=true`,
    };
  }

  if (type === 'movie') {
    return {
      vidking: `https://www.vidking.net/embed/movie/${tmdbId}`,
      vidsrc: `https://vidsrcme.ru/embed/movie/${tmdbId}`,
      vidlink: `https://vidlink.pro/movie/${tmdbId}?autoplay=true`,
    };
  }

  return { vidking: null, vidsrc: null, vidlink: null };
}
