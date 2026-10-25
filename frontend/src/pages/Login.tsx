import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Lock, Eye, EyeOff, Film } from 'lucide-react';

export const Login: React.FC = () => {
  const { login } = useAuth();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Please enter a password');
      return;
    }
    
    setError('');
    setIsSubmitting(true);
    
    const success = await login(password);
    if (!success) {
      setError('Incorrect password. Access denied.');
      setIsSubmitting(false);
    }
  };

  return (
    <div style={styles.container}>
      <form onSubmit={handleSubmit} className="glass-panel" style={styles.card}>
        <div style={styles.header}>
          <div style={styles.iconContainer}>
            <Film size={28} color="#00f2fe" />
          </div>
          <h1 style={styles.title}>Private Stream Box</h1>
          <p style={styles.subtitle}>Enter password to unlock your library</p>
        </div>

        <div style={styles.inputContainer}>
          <div style={styles.inputWrapper}>
            <Lock size={18} style={styles.inputIcon} />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="glass-input"
              style={styles.input}
              disabled={isSubmitting}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={styles.eyeButton}
              disabled={isSubmitting}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          
          {error && <div style={styles.error}>{error}</div>}
        </div>

        <button
          type="submit"
          className="glass-button glass-button-primary"
          style={styles.button}
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Unlocking...' : 'Unlock Server'}
        </button>
      </form>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '20px',
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    padding: '40px 32px',
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
    textAlign: 'center',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
  },
  iconContainer: {
    width: '60px',
    height: '60px',
    borderRadius: '16px',
    background: 'rgba(0, 242, 254, 0.08)',
    border: '1px solid rgba(0, 242, 254, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 0 20px rgba(0, 242, 254, 0.1)',
  },
  title: {
    fontSize: '28px',
    fontFamily: 'var(--font-display)',
    fontWeight: '700',
    background: 'linear-gradient(135deg, #ffffff 50%, #b3b3c6 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    fontSize: '14px',
    color: 'var(--text-secondary)',
  },
  inputContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    textAlign: 'left',
  },
  inputWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  inputIcon: {
    position: 'absolute',
    left: '16px',
    color: 'var(--text-muted)',
    pointerEvents: 'none',
  },
  input: {
    width: '100%',
    paddingLeft: '48px',
    paddingRight: '48px',
  },
  eyeButton: {
    position: 'absolute',
    right: '16px',
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    outline: 'none',
  },
  error: {
    color: 'var(--error)',
    fontSize: '13px',
    fontWeight: '500',
    paddingLeft: '4px',
  },
  button: {
    width: '100%',
    padding: '14px',
    fontSize: '16px',
  },
};
