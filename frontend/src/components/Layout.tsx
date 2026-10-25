import React, { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Clapperboard, Search, ChevronDown, Library as LibraryIcon } from 'lucide-react';

const GENRES = [
  { id: 28, name: 'Action' },
  { id: 12, name: 'Adventure' },
  { id: 16, name: 'Animation' },
  { id: 35, name: 'Comedy' },
  { id: 80, name: 'Crime' },
  { id: 18, name: 'Drama' },
  { id: 10751, name: 'Family' },
  { id: 14, name: 'Fantasy' },
  { id: 27, name: 'Horror' },
  { id: 9648, name: 'Mystery' },
  { id: 10749, name: 'Romance' },
  { id: 878, name: 'Sci-Fi' },
  { id: 53, name: 'Thriller' },
  { id: 10752, name: 'War' },
];

/**
 * Persistent app chrome: floating glass navbar (logo, nav links, genre dropdown,
 * prominent search, avatar/logout) wrapping the routed page via <Outlet />.
 */
export const Layout: React.FC = () => {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  const [query, setQuery] = useState('');
  const [genresOpen, setGenresOpen] = useState(false);
  const genresRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOutsideClick = (e: MouseEvent) => {
      if (genresRef.current && !genresRef.current.contains(e.target as Node)) {
        setGenresOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, []);

  const isActive = (path: string, qs?: string) => pathname === path && (!qs || search === qs);

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  };

  return (
    <div className="app-layout">
      <header className="layout-navbar glass-panel">
        <Link to="/" className="nav-logo">
          <Clapperboard size={22} color="var(--accent-primary)" />
          <span>StreamVault</span>
        </Link>

        <nav className="nav-links">
          <Link to="/search?type=movie" className={isActive('/search', '?type=movie') ? 'nav-link active' : 'nav-link'}>
            Movies
          </Link>
          <Link to="/search?type=tv" className={isActive('/search', '?type=tv') ? 'nav-link active' : 'nav-link'}>
            TV Shows
          </Link>
          <div className="genre-dropdown" ref={genresRef}>
            <button
              type="button"
              className="nav-link genre-trigger"
              onClick={() => setGenresOpen(o => !o)}
              aria-expanded={genresOpen}
            >
              Genres
              <ChevronDown
                size={14}
                style={{ transform: genresOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
              />
            </button>
            {genresOpen && (
              <div className="genre-menu glass-panel">
                {GENRES.map(g => (
                  <Link
                    key={g.id}
                    to={`/genre/${g.id}`}
                    className="genre-item"
                    onClick={() => setGenresOpen(false)}
                  >
                    {g.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </nav>

        <form className="nav-search" onSubmit={submitSearch} role="search">
          <div className="nav-search-box">
            <Search size={16} className="nav-search-icon" />
            <input
              className="nav-search-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search movies & shows..."
              aria-label="Search movies & shows"
            />
          </div>
          <button type="submit" className="glass-button nav-search-btn">Search</button>
        </form>

        <div className="nav-actions">
          <Link to="/library" className={isActive('/library') ? 'nav-link active nav-library' : 'nav-link nav-library'}>
            <LibraryIcon size={16} />
            Library
          </Link>
          <button className="nav-avatar" title="Log out" onClick={logout}>
            SV
          </button>
        </div>
      </header>

      <main className="layout-main">
        <Outlet />
      </main>
    </div>
  );
};
