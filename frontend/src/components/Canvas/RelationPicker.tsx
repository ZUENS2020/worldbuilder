import { RELATION_CONFIG, TAG_COLORS } from '../../types';
import { useAppStore } from '../../stores/appStore';

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
  const { customRelationTypes, addCustomRelationType } = useAppStore();

  return (
    <>
      {/* Backdrop */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 998 }} onClick={onCancel} />
      {/* Picker */}
      <div
        style={{
          position: 'fixed',
          left: Math.min(position.x, window.innerWidth - 220),
          top: Math.min(position.y, window.innerHeight - 400),
          zIndex: 999,
          background: 'var(--mt-panel)',
          border: '1px solid var(--mt-border)',
          borderRadius: 6,
          padding: 4,
          minWidth: 180,
          maxHeight: '60vh',
          overflowY: 'auto',
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

        {/* Built-in types */}
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

        {/* Custom types */}
        {customRelationTypes.length > 0 && (
          <>
            <div style={{ padding: '4px 10px 2px', fontSize: 9, color: 'var(--mt-text-faint)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, borderTop: '1px solid var(--mt-border-soft)', marginTop: 2 }}>
              自定义
            </div>
            {customRelationTypes.map((ct) => (
              <div
                key={ct.id}
                onClick={() => onSelect(ct.id)}
                style={{
                  padding: '5px 10px', cursor: 'pointer', borderRadius: 3,
                  fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
                  margin: '1px 0',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--mt-accent-bg)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: ct.color, flexShrink: 0 }} />
                <span>{ct.name}</span>
              </div>
            ))}
          </>
        )}

        {/* Quick create custom type */}
        <div
          style={{
            padding: '5px 10px', cursor: 'pointer', borderRadius: 3,
            fontSize: 11, display: 'flex', alignItems: 'center', gap: 6,
            margin: '2px 0 0', borderTop: '1px solid var(--mt-border-soft)', paddingTop: 6,
            color: 'var(--mt-accent)',
          }}
          onClick={() => {
            const name = prompt('自定义关系类型名称:');
            if (!name?.trim()) return;
            const color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
            addCustomRelationType(name.trim(), color, 'solid');
            // The new type's id will be generated; select it after next render
            // We use a short timeout to let the store update
            setTimeout(() => {
              const state = useAppStore.getState();
              const latest = state.customRelationTypes[state.customRelationTypes.length - 1];
              if (latest) onSelect(latest.id);
            }, 50);
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--mt-accent-bg)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
        >
          <span>✨</span>
          <span>自定义新类型...</span>
        </div>
      </div>
    </>
  );
}
