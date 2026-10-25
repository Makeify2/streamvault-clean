import React from 'react';
import { X } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

const ToggleRow: React.FC<ToggleRowProps> = ({ label, description, checked, onChange }) => (
  <div style={styles.row}>
    <div style={styles.rowText}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={styles.rowDesc}>{description}</span>
    </div>
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{ ...styles.toggle, ...(checked ? styles.toggleOn : styles.toggleOff) }}
      title={checked ? 'Disable' : 'Enable'}
    >
      <span style={{ ...styles.thumb, transform: checked ? 'translateX(20px)' : 'translateX(2px)' }} />
    </button>
  </div>
);

interface SettingsModalProps {
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const { settings, updateSetting } = useSettings();

  return (
    <div style={styles.backdrop} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>Settings</span>
          <button onClick={onClose} style={styles.closeBtn} title="Close">
            <X size={18} />
          </button>
        </div>

        <div style={styles.section}>
          <span style={styles.sectionLabel}>Playback</span>

          <ToggleRow
            label="Auto-play next episode"
            description="Automatically start the next episode when the current one ends"
            checked={settings.autoPlayNextEpisode}
            onChange={v => updateSetting('autoPlayNextEpisode', v)}
          />
          <ToggleRow
            label="Resume watching"
            description="Pick up where you left off when reopening a video"
            checked={settings.resumeWatching}
            onChange={v => updateSetting('resumeWatching', v)}
          />
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.65)',
    backdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 500,
  },
  panel: {
    background: 'rgba(18, 18, 28, 0.97)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '20px',
    padding: '32px',
    minWidth: '360px',
    maxWidth: '480px',
    width: '90vw',
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '28px',
  },
  title: {
    fontSize: '18px',
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    padding: '4px',
    borderRadius: '6px',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0',
  },
  sectionLabel: {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--accent-primary)',
    marginBottom: '16px',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '24px',
    padding: '14px 0',
    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
  },
  rowText: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    minWidth: 0,
  },
  rowLabel: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  rowDesc: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    lineHeight: '1.4',
  },
  toggle: {
    position: 'relative',
    width: '44px',
    height: '26px',
    borderRadius: '13px',
    border: 'none',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.2s ease',
  },
  toggleOn: {
    background: 'var(--accent-primary)',
  },
  toggleOff: {
    background: 'rgba(255, 255, 255, 0.15)',
  },
  thumb: {
    position: 'absolute',
    top: '3px',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    background: '#ffffff',
    transition: 'transform 0.2s ease',
    boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
  },
};
