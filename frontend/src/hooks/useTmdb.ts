import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiUrl } from '../lib/api';

export interface TmdbMediaItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
  media_type?: string;
}

interface UseTmdbResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Generic authenticated GET against the backend's TMDb proxy.
 * Pass a null path to skip the request (e.g. no query yet).
 */
function useTmdb<T>(path: string | null): UseTmdbResult<T> {
  const { token } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path || !token) {
      setData(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(apiUrl(path), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const json = await res.json();
        if (!cancelled) {
          if (res.ok && json.success) {
            setData(json.data as T);
          } else {
            setError(json.detail || 'Request failed');
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [path, token]);

  return { data, loading, error };
}

export const useTrending = (type: 'movie' | 'tv', page = 1) =>
  useTmdb<TmdbMediaItem[]>(`/api/tmdb/trending?type=${type}&page=${page}`);

export const usePopular = (type: 'movie' | 'tv', page = 1) =>
  useTmdb<TmdbMediaItem[]>(`/api/tmdb/popular?type=${type}&page=${page}`);

export const useMovieDetail = (id: string | undefined) =>
  useTmdb<any>(id ? `/api/tmdb/movie/${id}` : null);

export const useTVDetail = (id: string | undefined) =>
  useTmdb<any>(id ? `/api/tmdb/tv/${id}` : null);

export const useTVSeason = (id: string | undefined, season: number | null) =>
  useTmdb<any>(id && season !== null ? `/api/tmdb/tv/${id}/season/${season}` : null);

export const useSearch = (query: string, type: 'movie' | 'tv', page = 1) => {
  const q = query.trim();
  return useTmdb<TmdbMediaItem[]>(
    q ? `/api/tmdb/search?query=${encodeURIComponent(q)}&type=${type}&page=${page}` : null
  );
};

export const useGenreMovies = (genreId: string | undefined, page = 1) =>
  useTmdb<TmdbMediaItem[]>(genreId ? `/api/tmdb/genre/${genreId}/movies?page=${page}` : null);

export const useGenres = () =>
  useTmdb<{ movie: { id: number; name: string }[]; tv: { id: number; name: string }[] }>('/api/tmdb/genres');

export const useCredits = (type: 'movie' | 'tv', id: string | undefined) =>
  useTmdb<any>(id ? `/api/tmdb/credits/${type}/${id}` : null);

export const useTrailer = (type: 'movie' | 'tv', id: string | undefined) =>
  useTmdb<{ key: string; name: string }>(id ? `/api/tmdb/trailer/${type}/${id}` : null);
