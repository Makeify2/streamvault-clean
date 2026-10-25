// TMDb data layer: types, backend-proxy API helpers, and image URL builders.
import { apiUrl } from './api';

export interface TMDBItem {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  media_type?: string;
  original_language?: string;
}

export interface TMDBGenre {
  id: number;
  name: string;
}

export interface TMDBSeason {
  id: number;
  name: string;
  overview?: string;
  poster_path: string | null;
  season_number: number;
  episode_count: number;
  air_date?: string;
}

export interface TMDBEpisode {
  id: number;
  name: string;
  overview?: string;
  still_path: string | null;
  episode_number: number;
  air_date?: string;
  vote_average?: number;
}

export interface TMDBCastMember {
  id: number;
  name: string;
  character?: string;
  profile_path: string | null;
  order: number;
}

export interface TMDBVideo {
  key: string;
  name: string;
  site: string;
  type: string;
}

export interface TMDBMovieDetail extends TMDBItem {
  genres?: TMDBGenre[];
  runtime?: number;
  status?: string;
  tagline?: string;
  credits?: { cast?: TMDBCastMember[] };
  videos?: { results?: TMDBVideo[] };
}

export interface TMDBTVDetail extends TMDBItem {
  genres?: TMDBGenre[];
  seasons?: TMDBSeason[];
  number_of_seasons?: number;
  status?: string;
  tagline?: string;
  credits?: { cast?: TMDBCastMember[] };
  videos?: { results?: TMDBVideo[] };
}

const TMDB_IMG = 'https://image.tmdb.org/t/p';

export function tmdbImage(path: string | null | undefined, size: string): string | null {
  return path ? `${TMDB_IMG}/${size}${path}` : null;
}

export const posterUrl = (path: string | null | undefined) => tmdbImage(path, 'w500');
export const backdropUrl = (path: string | null | undefined) => tmdbImage(path, 'w1280');
export const originalBackdropUrl = (path: string | null | undefined) => tmdbImage(path, 'original');
export const profileUrl = (path: string | null | undefined) => tmdbImage(path, 'w185');

export function mediaTitle(m: TMDBItem): string {
  return m.title || m.name || 'Untitled';
}

export function mediaYear(m: TMDBItem): string | undefined {
  const d = m.release_date || m.first_air_date;
  return d ? d.slice(0, 4) : undefined;
}

export function mediaTypeOf(m: TMDBItem): 'movie' | 'tv' | undefined {
  if (m.media_type === 'movie' || m.media_type === 'tv') return m.media_type;
  return undefined;
}

async function tmdbGet<T>(token: string | null, path: string): Promise<T> {
  const res = await fetch(apiUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) {
    throw new Error(body?.detail || `TMDb request failed (${res.status})`);
  }
  return body.data as T;
}

export const fetchTrending = (token: string | null, type: 'movie' | 'tv', page = 1) =>
  tmdbGet<TMDBItem[]>(token, `/api/tmdb/trending?type=${type}&page=${page}`);

export const fetchPopular = (token: string | null, type: 'movie' | 'tv', page = 1) =>
  tmdbGet<TMDBItem[]>(token, `/api/tmdb/popular?type=${type}&page=${page}`);

export interface GenreResponse {
  movie: TMDBGenre[];
  tv: TMDBGenre[];
}

export const fetchGenres = (token: string | null) =>
  tmdbGet<GenreResponse>(token, '/api/tmdb/genres');

export const fetchGenreMovies = (
  token: string | null,
  genreId: number | string,
  page = 1,
  type: 'movie' | 'tv' = 'movie',
) =>
  tmdbGet<TMDBItem[]>(token, `/api/tmdb/genre/${genreId}/movies?type=${type}&page=${page}`);

export const fetchMovieDetail = (token: string | null, id: number) =>
  tmdbGet<TMDBMovieDetail>(token, `/api/tmdb/movie/${id}`);

export const fetchTVDetail = (token: string | null, id: number) =>
  tmdbGet<TMDBTVDetail>(token, `/api/tmdb/tv/${id}/full`);

export const fetchSearch = (token: string | null, query: string, type: 'movie' | 'tv') =>
  tmdbGet<TMDBItem[]>(token, `/api/tmdb/search?query=${encodeURIComponent(query)}&type=${type}`);

export const fetchSeason = (token: string | null, id: number, season: number) =>
  tmdbGet<{ episodes: TMDBEpisode[] }>(token, `/api/tmdb/tv/${id}/season/${season}`);

export const fetchCredits = (token: string | null, type: 'movie' | 'tv', id: number) =>
  tmdbGet<{ cast: TMDBCastMember[] }>(token, `/api/tmdb/credits/${type}/${id}`);

export const fetchTrailer = (token: string | null, type: 'movie' | 'tv', id: number) =>
  tmdbGet<{ key: string; name: string }>(token, `/api/tmdb/trailer/${type}/${id}`);
