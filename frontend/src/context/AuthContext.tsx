import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiUrl } from '../lib/api';

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  login: (password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(localStorage.getItem('stream_token'));
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const logout = () => {
    localStorage.removeItem('stream_token');
    setToken(null);
    setIsAuthenticated(false);
  };

  // Any component can dispatch this event to trigger an immediate logout (e.g. on a 401 response)
  useEffect(() => {
    const onExpired = () => logout();
    window.addEventListener('sv-auth-expired', onExpired);
    return () => window.removeEventListener('sv-auth-expired', onExpired);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Verify token on mount or token changes
  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setIsAuthenticated(false);
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetch(apiUrl('/api/auth/status'), {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        const data = await response.json();
        if (response.ok && data.success) {
          setIsAuthenticated(true);
        } else {
          logout();
        }
      } catch (error) {
        console.error('Error verifying auth token:', error);
        // On network error, keep current state — only logout on an explicit server rejection
      } finally {
        setIsLoading(false);
      }
    };

    verifyToken();
  }, [token]);

  // Re-verify token every 15 minutes so an expired/invalidated session is caught proactively
  useEffect(() => {
    if (!token) return;
    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(apiUrl('/api/auth/status'), {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) logout();
      } catch {
        // Network hiccup — don't log out, just wait for next check
      }
    }, 15 * 60 * 1000);
    return () => window.clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const login = async (password: string): Promise<boolean> => {
    try {
      const response = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password })
      });

      const data = await response.json();
      if (response.ok && data.success && data.token) {
        localStorage.setItem('stream_token', data.token);
        setToken(data.token);
        setIsAuthenticated(true);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, isLoading, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
