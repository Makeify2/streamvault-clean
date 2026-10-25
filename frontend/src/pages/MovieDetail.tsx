import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Play, Star, Clock, Loader2, Film } from 'lucide-react';
import { useMovieDetail, useCredits, useTrailer } from '../hooks/useTmdb';
import { tmdbImage } from '../lib/utils';

/**
 * Movie detail — backdrop, poster, meta, cast row, trailer, Watch Now.
 */
export const MovieDetail: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: movie, loading } = useMovieDetail(id);
  const { data: credits } = useCredits('movie', id);
  const { data: trailer } = useTrailer('movie', id);

  if (loading) {
    return (
      <div className="page-loading">
        <Loader2 size={40} className="spinner" />
        <p>Loading movie...</p>
      </div>
    );
  }

  if (!movie) {
    return (
      <div className="page-container" style={{ paddingTop: 48 }}>
        <h1 className="page-title">Movie not found</h1>
        <p className="page-subtitle">This title isn't available in TMDb.</p>
      </div>
    );
  }

  const cast = (credits?.cast ?? []).slice(0, 10);
  const genres: { id: number; name: string }[] = movie.genres ?? [];
  const backdrop = tmdbImage(movie.backdrop_path || movie.poster_path, 'w1280');

  return (
    <div className="detail-page">
      {backdrop && <div className="detail-backdrop" style={{ backgroundImage: `url(${backdrop})` }} />}

      <div className="detail-body page-container">
        <div className="detail-hero">
          <div className="detail-poster-wrap">
            {movie.poster_path ? (
              <img src={tmdbImage(movie.poster_path, 'w500')} alt={movie.title} />
            ) : (
              <Film size={64} color="var(--text-muted)" />
            )}
          </div>

          <div className="detail-info">
            <h1 className="page-title">{movie.title}</h1>
            <div className="detail-meta">
              {movie.release_date && <span>{movie.release_date.slice(0, 4)}</span>}
              {movie.runtime ? (
                <span><Clock size={14} /> {movie.runtime} min</span>
              ) : null}
              {movie.vote_average > 0 && (
                <span className="detail-rating">
                  <Star size={14} fill="currentColor" /> {movie.vote_average.toFixed(1)}
                </span>
              )}
            </div>
            {genres.length > 0 && (
              <div className="genre-pills">
                {genres.map(g => <span key={g.id} className="genre-pill">{g.name}</span>)}
              </div>
            )}
            {movie.overview && <p className="detail-overview">{movie.overview}</p>}
            <div className="hero-actions">
              <button className="glass-button glass-button-primary" onClick={() => navigate(`/watch/movie/${movie.id}`)}>
                <Play size={16} fill="currentColor" /> Watch Now
              </button>
            </div>
          </div>
        </div>

        {cast.length > 0 && (
          <section>
            <h2 className="section-title">Cast</h2>
            <div className="cast-row">
              {cast.map((person: any) => (
                <div key={person.id} className="cast-card">
                  {person.profile_path ? (
                    <img src={tmdbImage(person.profile_path, 'w185')} alt={person.name} loading="lazy" />
                  ) : (
                    <div className="cast-fallback"><Film size={26} color="var(--text-muted)" /></div>
                  )}
                  <p className="cast-name">{person.name}</p>
                  <p className="cast-role">{person.character}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {trailer?.key && (
          <section>
            <h2 className="section-title">Trailer</h2>
            <div className="trailer-embed">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${trailer.key}`}
                title={trailer.name || 'Trailer'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
