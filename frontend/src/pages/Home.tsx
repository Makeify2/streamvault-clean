import React from 'react';
import { Link } from 'react-router-dom';
import { Play, Loader2 } from 'lucide-react';
import { useTrending, usePopular } from '../hooks/useTmdb';
import type { TmdbMediaItem } from '../hooks/useTmdb';
import { MediaCard } from '../components/MediaCard';
import { tmdbImage } from '../lib/utils';

interface MediaRowProps {
  title: string;
  items: TmdbMediaItem[];
  type: 'movie' | 'tv';
  loading: boolean;
}

const MediaRow: React.FC<MediaRowProps> = ({ title, items, type, loading }) => (
  <section>
    <h2 className="section-title">{title}</h2>
    {loading ? (
      <div className="row-stub glass-panel">
        <Loader2 size={28} className="spinner" />
      </div>
    ) : items.length === 0 ? (
      <div className="row-stub glass-panel">
        <p className="page-subtitle">Nothing here yet.</p>
      </div>
    ) : (
      <div className="media-row">
        {items.map(item => (
          <MediaCard key={item.id} item={item} type={type} />
        ))}
      </div>
    )}
  </section>
);

/**
 * Home — hero featuring the top trending movie, then trending/popular rows.
 */
export const Home: React.FC = () => {
  const trendingMovies = useTrending('movie');
  const trendingTV = useTrending('tv');
  const popularMovies = usePopular('movie');
  const popularTV = usePopular('tv');

  const hero = trendingMovies.data?.[0] ?? null;
  const heroBackdrop = tmdbImage(hero?.backdrop_path || hero?.poster_path, 'w1280');

  return (
    <div className="home-page">
      {hero && (
        <section
          className="hero-section"
          style={{
            backgroundImage: heroBackdrop
              ? `linear-gradient(to bottom, rgba(7,7,10,0.3), var(--bg-dark) 92%), url(${heroBackdrop})`
              : undefined
          }}
        >
          <div className="hero-content">
            <p className="hero-kicker">Trending this week</p>
            <h1 className="hero-title">{hero.title || hero.name}</h1>
            {hero.overview && <p className="hero-overview">{hero.overview}</p>}
            <div className="hero-actions">
              <Link to={`/movie/${hero.id}`} className="glass-button glass-button-primary">
                <Play size={16} fill="currentColor" /> Watch Now
              </Link>
              <Link to={`/movie/${hero.id}`} className="glass-button">Details</Link>
            </div>
          </div>
        </section>
      )}

      <div className="page-container" style={{ marginTop: 28 }}>
        <MediaRow title="Trending Movies" items={trendingMovies.data ?? []} type="movie" loading={trendingMovies.loading} />
        <MediaRow title="Trending TV Shows" items={trendingTV.data ?? []} type="tv" loading={trendingTV.loading} />
        <MediaRow title="Popular Movies" items={popularMovies.data ?? []} type="movie" loading={popularMovies.loading} />
        <MediaRow title="Popular TV Shows" items={popularTV.data ?? []} type="tv" loading={popularTV.loading} />
      </div>
    </div>
  );
};
