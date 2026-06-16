import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Entity, EntityType } from '../../types';
import { ENTITY_CONFIG } from '../../types';

const DIM = 54;

// Maltego "ball"-style entity node: a colored circle with the value label below.
// Has hidden center handles (for radial spoke edges) plus a visible
// "connection port" that appears on hover so users can drag to create relations.
function EntityNode({ data, selected }: NodeProps) {
  const entity = data.entity as Entity;
  const config = ENTITY_CONFIG[entity.type as EntityType] || ENTITY_CONFIG.character;
  const aiInferred = (entity.properties as Record<string, unknown> | undefined)?.ai_inferred;
  const [hovering, setHovering] = useState(false);

  // Hidden center handles: edges connect center-to-center for radial spokes.
  const centerHandle: React.CSSProperties = {
    width: 1, height: 1, minWidth: 0, minHeight: 0, border: 'none', background: 'transparent',
    top: DIM / 2, left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none',
  };

  // Visible connection port: appears at the bottom of the circle on hover.
  // This is the ONLY handle with pointerEvents enabled — drag from here to create a relation.
  const portStyle: React.CSSProperties = {
    width: 14,
    height: 14,
    borderRadius: '50%',
    background: hovering ? config.color : `${config.color}88`,
    border: '2px solid #fff',
    bottom: -3,
    left: '50%',
    transform: 'translateX(-50%)',
    cursor: 'crosshair',
    transition: 'opacity 0.15s, transform 0.15s',
    opacity: hovering || selected ? 1 : 0,
    zIndex: 5,
  };

  return (
    <div
      style={{ position: 'relative', width: DIM, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Selection halo */}
      {selected && (
        <div
          style={{
            position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)',
            width: DIM + 12, height: DIM + 12, borderRadius: '50%',
            background: `${config.color}22`, border: `2px solid ${config.color}`,
          }}
        />
      )}

      {/* Circle */}
      <div
        style={{
          width: DIM, height: DIM, borderRadius: '50%',
          background: `radial-gradient(circle at 35% 30%, ${config.color}, ${shade(config.color, -18)})`,
          border: '2px solid #ffffff',
          boxShadow: selected
            ? `0 0 0 1px ${config.color}, 0 3px 10px ${config.color}66`
            : '0 2px 6px rgba(0,0,0,0.28)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, lineHeight: 1, position: 'relative', zIndex: 1,
        }}
      >
        <span style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.3))' }}>{config.icon}</span>
        {aiInferred ? (
          <span
            title="AI 推断"
            style={{
              position: 'absolute', top: -4, right: -4, fontSize: 9, background: '#fff',
              borderRadius: '50%', border: '1px solid var(--mt-border)', width: 15, height: 15,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            🤖
          </span>
        ) : null}
      </div>

      {/* Value label */}
      <div
        style={{
          marginTop: 5, maxWidth: 104, textAlign: 'center', fontSize: 11,
          color: 'var(--mt-text)', lineHeight: 1.2, wordBreak: 'break-word',
          fontWeight: selected ? 700 : 500,
          textShadow: '0 1px 2px #fff, 0 0 2px #fff',
        }}
      >
        {entity.name}
      </div>

      {/* Hidden center handles -> radial spoke edges */}
      <Handle type="source" position={Position.Top} id="c" style={centerHandle} />
      <Handle type="target" position={Position.Top} id="c-t" style={centerHandle} />

      {/* Visible connection port — drag from here to create a relation.
          id="port" connects to "c-t" on the target, so new edges use
          the center handles for clean radial layout. */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="port"
        style={portStyle}
      />
    </div>
  );
}

// Darken a hex color by pct (negative = darker)
function shade(hex: string, pct: number): string {
  const m = hex.replace('#', '');
  const num = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  const amt = Math.round(2.55 * pct);
  const r = Math.max(0, Math.min(255, (num >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}

export default memo(EntityNode);
