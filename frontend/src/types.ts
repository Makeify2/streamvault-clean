// Shared types used across Dashboard, DetailModal, VideoPlayer, and App.

export interface SubtitleTrack {
  id: number;
  name: string;
  language: string;
  lang: string;
  label: string;
}

export interface VideoFile {
  id: number;
  name: string;
  size: number;
  subtitles: SubtitleTrack[];
}

export interface TorrentMetadata {
  title: string;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  releaseDate?: string;
  rating?: number;
  genres?: string[];
  type: 'movie' | 'tv' | 'other';
  isMedia?: boolean;
  tmdbId?: number;
  parsed: {
    title?: string;
    year?: string;
    season?: number;
    episode?: number;
  };
}

export interface BadgeMeta {
  id: string;
  name: string;
  color: string;
}

export interface TorrentSource {
  torrentId: number;
  name: string;
  hash: string;
  size: number;
  progress: number;
  status: string;
  download_finished: boolean;
  ready: boolean;
  videoFiles: VideoFile[];
  badges?: BadgeMeta[];
}

export interface Torrent {
  id: number;
  name: string;
  hash: string;
  size: number;
  progress: number;
  status: string;
  download_finished: boolean;
  ready: boolean;
  isMedia: boolean;
  metadata: TorrentMetadata;
  videoFiles: VideoFile[];
  badges?: BadgeMeta[];
  sources?: TorrentSource[];
}
