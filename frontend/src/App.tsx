import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SettingsProvider } from './context/SettingsContext';
import { Login } from './pages/Login';
import { Layout } from './components/Layout';
import { Loader2 } from 'lucide-react';
import { GyaruEasterEgg } from './components/GyaruEasterEgg';
import { ErrorBoundary } from './components/ErrorBoundary';

// Route-level code splitting: keeps the heavy player/library chunks out of the
// initial bundle so discovery pages load fast.
const Home = lazy(() => import('./pages/Home').then(m => ({ default: m.Home })));
const MovieDetail = lazy(() => import('./pages/MovieDetail').then(m => ({ default: m.MovieDetail })));
const TVDetail = lazy(() => import('./pages/TVDetail').then(m => ({ default: m.TVDetail })));
const SearchPage = lazy(() => import('./pages/SearchPage').then(m => ({ default: m.SearchPage })));
const GenrePage = lazy(() => import('./pages/GenrePage').then(m => ({ default: m.GenrePage })));
const WatchPage = lazy(() => import('./pages/WatchPage').then(m => ({ default: m.WatchPage })));
const Library = lazy(() => import('./pages/Library').then(m => ({ default: m.Library })));

const FullScreenLoader: React.FC = () => (
  <div style={styles.loadingContainer}>
    <Loader2 size={48} className="spinner" />
    <p style={styles.loadingText}>Initializing secure connection...</p>
  </div>
);

/** Blocks protected routes until the session is verified, bouncing to /login otherwise. */
const RequireAuth: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <FullScreenLoader />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
};

/** Redirects already-authenticated users away from the login page. */
const LoginRoute: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <FullScreenLoader />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <Login />;
};

const NotFound: React.FC = () => (
  <div className="page-container" style={{ textAlign: 'center', paddingTop: 120 }}>
    <h1 className="page-title" style={{ fontSize: 56 }}>404</h1>
    <p className="page-subtitle">That page doesn't exist.</p>
    <Link to="/" className="glass-button glass-button-primary" style={{ marginTop: 24 }}>
      Back home
    </Link>
  </div>
);

export const App: React.FC = () => {
  return (
    <SettingsProvider>
      <AuthProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <Suspense fallback={<FullScreenLoader />}>
              <Routes>
                <Route path="/login" element={<LoginRoute />} />
                <Route element={<RequireAuth />}>
                  {/* Discovery pages inside the shared layout */}
                  <Route element={<Layout />}>
                    <Route path="/" element={<Home />} />
                    <Route path="/movie/:id" element={<MovieDetail />} />
                    <Route path="/tv/:id" element={<TVDetail />} />
                    <Route path="/search" element={<SearchPage />} />
                    <Route path="/genre/:genreId" element={<GenrePage />} />
                    <Route path="/watch" element={<WatchPage />} />
                    <Route path="/watch/:type/:id" element={<WatchPage />} />
                    <Route path="/library" element={<Library />} />
                    <Route path="*" element={<NotFound />} />
                  </Route>
                </Route>
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </BrowserRouter>
        <GyaruEasterEgg />
      </AuthProvider>
    </SettingsProvider>
  );
};

const styles: Record<string, React.CSSProperties> = {
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    gap: '16px',
  },
  loadingText: {
    color: 'var(--text-secondary)',
    fontSize: '16px',
    fontWeight: '500',
  },
};

export default App;
