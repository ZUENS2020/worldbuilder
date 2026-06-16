import { RELATION_CONFIG } from '../../types';

interface RelationPickerProps {
  onSelect: (type: string) => void;
  onCancel: () => void;
  sourceName: string;
  targetName: string;
  position: { x: number; y: number };
}

const COMMON_TYPES = [
  'ally', 'enemy', 'lover', 'family', 'rival',
  'mentor', 'subordinate', 'member_of', 'located_at',
  'participated', 'caused', 'followed_by',
];

export default function RelationPicker({
  onSelect, onCancel, sourceName, targetName, position,
}: RelationPickerProps) {
  return (
    <>
      {/* Backdrop */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 998 }} onClick={onCancel} />
      {/* Picker */}
      <div
        style={{
          position: 'fixed',
          left: Math.min(position.x, window.innerWidth - 200),
          top: Math.min(position.y, window.innerHeight - 300),
          zIndex: 999,
          background: 'var(--mt-panel)',
          border: '1px solid var(--mt-border)',
          borderRadius: 6,
          padding: 4,
          minWidth: 160,
          boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div style={{
          padding: '6px 10px', borderBottom: '1px solid var(--mt-border)',
          fontSize: 11, color: 'var(--mt-text-muted)', fontWeight: 600,
        }}>
          {sourceName} → {targetName}
        </div>
        {COMMON_TYPES.map((t) => {
          const c = RELATION_CONFIG[t] || { color: '#888', label: t };
          return (
            <div
              key={t}
              onClick={() => onSelect(t)}
              style={{
                padding: '5px 10px', cursor: 'pointer', borderRadius: 3,
                fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
                margin: '1px 0',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--mt-accent-bg)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
              <span>{c.label}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
