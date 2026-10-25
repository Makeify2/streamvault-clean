import React, { useEffect, useRef, useState } from 'react';

const TRIGGER = 'gyaru';
const GIF_URL = 'https://media1.tenor.com/m/w153EZOGKM0AAAAd/ado-gyaru.gif';
const AUTO_DISMISS_MS = 4000;

/**
 * Easter egg: type "gyaru" anywhere on the page to summon the gif.
 * Mounted once at the app root so it works from any screen.
 */
export const GyaruEasterEgg: React.FC = () => {
  const [show, setShow] = useState(false);
  const bufferRef = useRef('');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.length !== 1) return; // ignore Shift, Enter, arrows, etc.
      bufferRef.current = (bufferRef.current + e.key.toLowerCase()).slice(-TRIGGER.length);
      if (bufferRef.current === TRIGGER) {
        setShow(true);
        bufferRef.current = '';
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!show) return;
    const timer = window.setTimeout(() => setShow(false), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [show]);

  if (!show) return null;

  return (
    <div style={styles.backdrop} onClick={() => setShow(false)}>
      <img src={GIF_URL} alt="gyaru" style={styles.gif} />
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    background: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 99999,
    cursor: 'pointer',
  },
  gif: {
    maxWidth: '90vw',
    maxHeight: '90vh',
    borderRadius: '16px',
    boxShadow: '0 0 60px rgba(0, 242, 254, 0.3)',
  },
};
