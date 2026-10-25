import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Loader2 } from 'lucide-react';
import { useSearch } from '../hooks/useTmdb';
import { MediaCard } from '../components/MediaCard';

/**
 * Search — debounced input synced to the URL, movie/TV toggle, result grid.
 */
export const SearchPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQuery = searchParams.get('q') ?? '';
  const urlType = searchParams.get('type') === 'tv' ? 'tv' : 'movie';

  const [input, setInput] = useState(urlQuery);
  const [type, setType] = useState<'movie' | 'tv'>(urlType);
  const [debounced, setDebounced] = useState(urlQuery);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(input.trim()), 350);
    return () => clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    setSearchParams(
      params => {
        if (debounced) params.set('q', debounced);
        else params.delete('q');
        params.set('type', type);
        return params;
      },
      { replace: true }
    );
  }, [debounced, type, setSearchParams]);

  const { data: results, loading } = useSearch(debounced, type);

  return (
    <div className="page-container">
      <h1 className="page-title">Search</h1>

      <div className="search-bar">
        <div className="nav-search-box search-page-box">
          <Search size={17} className="nav-search-icon" />
          <input
            className="nav-search-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Search movies & shows..."
            autoFocus
          />
        </div>
      </div>

      <div className="search-tabs">
        <button className={type === 'movie' ? 'search-tab active' : 'search-tab'} onClick={() => setType('movie')}>
          Movies
        </button>
        <button className={type === 'tv' ? 'search-tab active' : 'search-tab'} onClick={() => setType('tv')}>
          TV Shows
        </button>
      </div>

      {!debounced ? (
        <div className="empty-state">
          <Search size={40} color="var(--text-muted)" />
          <p>Search for your favorite movies and shows</p>
        </div>
      ) : loading ? (
        <div className="page-loading">
          <Loader2 size={34} className="spinner" />
          <p>Searching...</p>
        </div>
      ) : results && results.length > 0 ? (
        <div className="media-grid">
          {results.map(item => (
            <MediaCard key={item.id} item={item} type={type} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>No results for "{debounced}"</p>
        </div>
      )}
    </div>
  );
};
