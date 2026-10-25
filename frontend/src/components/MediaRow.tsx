import React, { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MediaCard, MediaCardSkeleton } from './MediaCard';
import type { TMDBItem } from '../lib/tmdb';

interface MediaRowProps {
  title: string;
  items: TMDBItem[];
  type?: 'movie' | 'tv';
  loading?: boolean;
  error?: string;
  seeAllTo?: string;
}

export const MediaRow: React.FC<MediaRowProps> = ({ title, items, type, loading, error, seeAllTo }) => {
  const scroller = useRef<HTMLDivElement>(null);

  const scrollBy = (dir: number) => {
    scroller.current?.scrollBy({ left: dir * (scroller.current.clientWidth * 0.8), behavior: 'smooth' });
  };

  return (
    <section className="media-row">
      <div className="media-row-header">
        <h2 className="section-title">{title}</h2>
        {seeAllTo && (
          <Link to={seeAllTo} className="media-row-seeall">
            See all
          </Link>
        )}
      </div>
      {error ? (
        <p className="media-row-error">{error}</p>
      ) : (
        <div className="media-row-scroller" ref={scroller}>
          {loading
            ? Array.from({ length: 8 }, (_, i) => <MediaCardSkeleton key={i} />)
            : items.map(item => <MediaCard key={item.id} item={item} type={type} />)}
        </div>
      )}
      {!loading && !error && items.length > 0 && (
        <>
          <button
            type="button"
            className="media-row-arrow left"
            onClick={() => scrollBy(-1)}
            aria-label="Scroll left"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            className="media-row-arrow right"
            onClick={() => scrollBy(1)}
            aria-label="Scroll right"
          >
            <ChevronRight size={20} />
          </button>
        </>
      )}
    </section>
  );
};
