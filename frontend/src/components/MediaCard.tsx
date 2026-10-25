import React from 'react';
import { Link } from 'react-router-dom';
import { Play, Film } from 'lucide-react';
import { tmdbImage } from '../lib/utils';
import type { TmdbMediaItem } from '../hooks/useTmdb';

interface MediaCardProps {
  item: TmdbMediaItem;
  type?: 'movie' | 'tv';
  showRating?: boolean;
}

/**
 * Poster card used across Home, Search, Genre, and Library grids.
 * Hover reveals a play overlay; clicking navigates to the detail page.
 */
export const MediaCard: React.FC<MediaCardProps> = ({ item, type, showRating = true }) => {
  const title = item.title || item.name || 'Untitled';
  const year = (item.release_date || item.first_air_date || '').slice(0, 4);
  const poster = tmdbImage(item.poster_path, 'w342');
  // Infer from the payload when no explicit type is given: TV items carry
  // `name`, movies carry `title` - keeps same-numeric-id movie/TV apart.
  const mediaType: 'movie' | 'tv' =
    type ?? (item.media_type === 'tv' || (!item.media_type && !!item.name) ? 'tv' : 'movie');
  const rating = item.vote_average ?? 0;

  return (
    <Link to={`/${mediaType}/${item.id}`} className="media-card glass-card">
      <div className="media-poster-wrap">
        {poster ? (
          <img className="poster media-poster" src={poster} alt={title} loading="lazy" />
        ) : (
          <div className="media-poster media-poster-fallback">
            <Film size={36} color="var(--text-muted)" />
          </div>
        )}
        <div className="play-overlay">
          <div className="play-overlay-circle">
            <Play size={22} fill="currentColor" />
          </div>
        </div>
        {showRating && rating > 0 && (
          <span className="rating-badge">{rating.toFixed(1)}</span>
        )}
      </div>
      <div className="media-card-info">
        <p className="media-card-title">{title}</p>
        <p className="media-card-year">{year || '\u00A0'}</p>
      </div>
    </Link>
  );
};

/**
 * Skeleton placeholder for grid rows while TMDb data is loading.
 */
export const MediaCardSkeleton: React.FC = () => (
  <div className="media-card glass-card">
    <div className="media-poster-wrap skeleton" />
    <div className="media-card-info">
      <div className="skeleton-line" style={{ width: '90%' }} />
      <div className="skeleton-line" style={{ width: '45%' }} />
    </div>
  </div>
);
