import React from 'react';
import type { BadgeMeta } from '../types';
export type { BadgeMeta } from '../types';

interface BadgeBarProps {
  badges: BadgeMeta[];
  max?: number;
}

export const BadgeBar: React.FC<BadgeBarProps> = ({ badges, max = 4 }) => {
  if (!badges || badges.length === 0) return null;

  const visible = badges.slice(0, max);
  const overflow = badges.length - max;

  return (
    <div style={styles.bar}>
      {visible.map((b) => (
        <span
          key={b.id}
          style={{
            ...styles.badge,
            borderColor: b.color,
          }}
        >
          {b.name}
        </span>
      ))}
      {overflow > 0 && (
        <span style={styles.overflow}>+{overflow}</span>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
  },
  badge: {
    fontSize: '10px',
    fontWeight: 700,
    padding: '1px 6px',
    borderRadius: '4px',
    border: '1px solid',
    color: '#fff',
    letterSpacing: '0.03em',
    lineHeight: '16px',
    whiteSpace: 'nowrap',
  },
  overflow: {
    fontSize: '10px',
    color: 'var(--text-muted)',
    padding: '1px 4px',
    lineHeight: '16px',
  },
};
