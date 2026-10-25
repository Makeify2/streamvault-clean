import axios from 'axios';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

const getParams = () => {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey || apiKey === 'your_tmdb_api_key_here') {
    throw new Error('TMDb API Key is not configured in .env file.');
  }
  return {
    api_key: apiKey
  };
};

export interface TMDbMedia {
  id: number;
  title: string;
  original_title?: string;
  name?: string; // TV shows use 'name' instead of 'title'
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  genre_ids?: number[];
  genres?: { id: number; name: string }[];
}

// --- Lightweight TTL cache for rate-limited list endpoints ---
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map<string, { expires: number; data: any }>();

async function cachedGet<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.data as T;
  const data = await fetcher();
  cache.set(key, { expires: Date.now() + ttlMs, data });
  if (cache.size > 200) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expires < now) cache.delete(k);
    }
  }
  return data;
}

/**
 * Searches for a movie on TMDb.
 */
export async function searchMovie(query: string, year?: string, page = 1): Promise<TMDbMedia[]> {
  try {
    const key = `searchMovie:${query}:${year ?? ''}:${page}`;
    return cachedGet(key, 5 * 60 * 1000, async () => {
      const params: any = {
        ...getParams(),
        query,
        include_adult: false,
        page
      };
      if (year) {
        params.year = year;
      }
      const response = await axios.get(`${TMDB_BASE_URL}/search/movie`, { params });
      return response.data.results || [];
    });
  } catch (error: any) {
    console.error('TMDb searchMovie error:', error.message);
    return [];
  }
}

/**
 * Searches for a TV show on TMDb.
 */
export async function searchTV(query: string, year?: string, page = 1): Promise<TMDbMedia[]> {
  try {
    const key = `searchTV:${query}:${year ?? ''}:${page}`;
    return cachedGet(key, 5 * 60 * 1000, async () => {
      const params: any = {
        ...getParams(),
        query,
        include_adult: false,
        page
      };
      if (year) {
        params.first_air_date_year = year;
      }
      const response = await axios.get(`${TMDB_BASE_URL}/search/tv`, { params });
      return response.data.results || [];
    });
  } catch (error: any) {
    console.error('TMDb searchTV error:', error.message);
    return [];
  }
}

/**
 * Fetches trending movies or TV shows for the week.
 */
export async function getTrending(type: 'movie' | 'tv', page = 1): Promise<TMDbMedia[]> {
  try {
    const key = `trending:${type}:${page}`;
    return cachedGet(key, CACHE_TTL_MS, async () => {
      const response = await axios.get(`${TMDB_BASE_URL}/trending/${type}/week`, {
        params: { ...getParams(), page }
      });
      return response.data.results || [];
    });
  } catch (error: any) {
    console.error(`TMDb getTrending error for ${type}:`, error.message);
    return [];
  }
}

/**
 * Fetches popular movies or TV shows.
 */
export async function getPopular(type: 'movie' | 'tv', page = 1): Promise<TMDbMedia[]> {
  try {
    const key = `popular:${type}:${page}`;
    return cachedGet(key, CACHE_TTL_MS, async () => {
      const response = await axios.get(`${TMDB_BASE_URL}/${type}/popular`, {
        params: { ...getParams(), page }
      });
      return response.data.results || [];
    });
  } catch (error: any) {
    console.error(`TMDb getPopular error for ${type}:`, error.message);
    return [];
  }
}

/**
 * Fetches the movie and TV genre lists.
 */
export async function getGenres(): Promise<{ movie: { id: number; name: string }[]; tv: { id: number; name: string }[] }> {
  try {
    const key = 'genres';
    return cachedGet(key, 30 * 60 * 1000, async () => {
      const [movie, tv] = await Promise.all([
        axios.get(`${TMDB_BASE_URL}/genre/movie/list`, { params: getParams() }),
        axios.get(`${TMDB_BASE_URL}/genre/tv/list`, { params: getParams() })
      ]);
      return {
        movie: movie.data.genres || [],
        tv: tv.data.genres || []
      };
    });
  } catch (error: any) {
    console.error('TMDb getGenres error:', error.message);
    return { movie: [], tv: [] };
  }
}

/**
 * Fetches movies belonging to a genre (ordered by popularity).
 */
export async function getMoviesByGenre(genreId: number, page = 1): Promise<TMDbMedia[]> {
  try {
    const key = `genre:${genreId}:${page}`;
    return cachedGet(key, CACHE_TTL_MS, async () => {
      const response = await axios.get(`${TMDB_BASE_URL}/discover/movie`, {
        params: {
          ...getParams(),
          with_genres: genreId,
          sort_by: 'popularity.desc',
          page
        }
      });
      return response.data.results || [];
    });
  } catch (error: any) {
    console.error(`TMDb getMoviesByGenre error for genre ${genreId}:`, error.message);
    return [];
  }
}

/**
 * Retrieves details for a specific movie on TMDb.
 */
export async function getMovieDetails(id: number): Promise<any> {
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/movie/${id}`, {
      params: getParams()
    });
    return response.data;
  } catch (error: any) {
    console.error(`TMDb getMovieDetails error for ID ${id}:`, error.message);
    return null;
  }
}

/**
 * Retrieves details for a specific TV show on TMDb.
 */
export async function getTVDetails(id: number): Promise<any> {
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/tv/${id}`, {
      params: getParams()
    });
    return response.data;
  } catch (error: any) {
    console.error(`TMDb getTVDetails error for ID ${id}:`, error.message);
    return null;
  }
}

/**
 * Retrieves TV Show season details (episodes list).
 */
export async function getTVSeason(id: number, seasonNumber: number): Promise<any> {
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/tv/${id}/season/${seasonNumber}`, {
      params: getParams()
    });
    return response.data;
  } catch (error: any) {
    console.error(`TMDb getTVSeason error for Show ID ${id} Season ${seasonNumber}:`, error.message);
    return null;
  }
}

/**
 * Retrieves cast credits for a movie or TV show.
 */
export async function getCredits(type: 'movie' | 'tv', id: number): Promise<any> {
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/${type}/${id}/credits`, {
      params: getParams()
    });
    return response.data;
  } catch (error: any) {
    console.error(`TMDb getCredits error for ${type} ID ${id}:`, error.message);
    return null;
  }
}

/**
 * Retrieves videos (trailers, teasers) for a movie or TV show.
 */
export async function getVideos(type: 'movie' | 'tv', id: number): Promise<any> {
  try {
    const response = await axios.get(`${TMDB_BASE_URL}/${type}/${id}/videos`, {
      params: getParams()
    });
    return response.data;
  } catch (error: any) {
    console.error(`TMDb getVideos error for ${type} ID ${id}:`, error.message);
    return null;
  }
}
