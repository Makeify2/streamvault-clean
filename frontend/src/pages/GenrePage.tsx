import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useGenres, useGenreMovies } from '../hooks/useTmdb';
import { MediaCard } from '../components/MediaCard';

/**
 * Genre browsing — movie grid with pagination (load more).
 */
export const GenrePage: React.FC = () => {
  const { genreId } = useParams();
  const { data: genres } = useGenres();
  const [page, setPage] = useState(1);
  const { data: movies, loading } = useGenreMovies(genreId, page);

  useEffect(() => {
    setPage(1);
  }, [genreId]);

  const genreName =
    genres?.movie.find(g => String(g.id) === genreId)?.name ??
    genres?.tv.find(g => String(g.id) === genreId)?.name ??
    'Genre';

  return (
    <div className="page-container">
      <h1 className="page-title">{genreName}</h1>

      {loading && page === 1 ? (
        <div className="page-loading">
          <Loader2 size={34} className="spinner" />
          <p>Loading {genreName.toLowerCase()} movies...</p>
        </div>
      ) : movies && movies.length > 0 ? (
        <>
          <div className="media-grid">
            {movies.map(item => (
              <MediaCard key={item.id} item={item} type="movie" />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
            <button className="glass-button" onClick={() => setPage(p => p + 1)} disabled={loading}>
              {loading ? <Loader2 size={16} className="spinner" /> : null}
              Load more
            </button>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <p>No movies found in this genre.</p>
        </div>
      )}
    </div>
  );
};
