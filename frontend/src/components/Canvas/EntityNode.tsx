import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { Entity, EntityType } from '../../types';
import { ENTITY_CONFIG } from '../../types';

/**
 * OSINT-style entity node, optimized for character-driven narrative graphs.
 *
 * Characters (primary): Large circle with name + role badge.
 *   - Shows faction colour ring if belongs to a faction.
 *   - Name is always visible (not just on hover).
 *
 * Factions (group): Rounded rectangle, like a Maltego "entity set".
 *
 * Events (incident): Hexagon, smaller, satellite to characters.
 *
 * Locations (infrastructure): Diamond, smallest, peripheral.
 */
function EntityNode({ data, selected }: NodeProps) {
  const entity = data.entity as Entity;
  const config = ENTITY_CONFIG[entity.type as EntityType] || ENTITY_CONFIG.character;
  const aiInferred = !!(entity.properties as Record<string, unknown> | undefined)?.ai_inferred;
  const [hovering, setHovering] = useState(false);

  const isChar = entity.type === 'character';
  const isFaction = entity.type === 'faction';
  const isEvent = entity.type === 'event';
  const dim = config.size;

  // Faction colour ring for characters
  const factionColor = isChar ? getFactionColor(entity) : null;

  // Hidden center handles for radial spoke edges
  const centerHandle: React.CSSProperties = {
    width: 1, height: 1, minWidth: 0, minHeight: 0, border: 'none', background: 'transparent',
    top: dim / 2, left: '50%', transform: 'translate(-50%, -50%)', pointerEvents: 'none',
  };

  // Visible connection port
  const portStyle: React.CSSProperties = {
    width: 14, height: 14, borderRadius: '50%',
    background: hovering ? config.color : `${config.color}88`,
    border: '2px solid #fff',
    bottom: isChar ? -6 : -4,
    left: '50%', transform: 'translateX(-50%)',
    cursor: 'crosshair',
    transition: 'opacity 0.15s, transform 0.15s',
    opacity: hovering || selected ? 1 : 0,
    zIndex: 5,
  };

  return (
    <div
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Selection halo */}
      {selected && (
        <div style={{
          position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)',
          width: dim + 12, height: dim + 12, borderRadius: isFaction ? 8 : '50%',
          background: `${config.color}18`, border: `2px solid ${config.color}`,
        }} />
      )}

      {/* ── Character: Large circle with faction ring ── */}
      {isChar && (
        <div style={{ position: 'relative', width: dim, height: dim }}>
          {/* Faction colour ring */}
          {factionColor && (
            <div style={{
              position: 'absolute', inset: -4, borderRadius: '50%',
              border: `3px solid ${factionColor}`, opacity: 0.7,
            }} />
          )}
          <div style={{
            width: dim, height: dim, borderRadius: '50%',
            background: `radial-gradient(circle at 35% 30%, ${config.color}, ${shade(config.color, -22)})`,
            border: '2px solid #ffffff',
            boxShadow: selected
              ? `0 0 0 1px ${config.color}, 0 3px 12px ${config.color}55`
              : '0 2px 8px rgba(0,0,0,0.30)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 26, lineHeight: 1, position: 'relative', zIndex: 1,
          }}>
            <span style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.3))' }}>{config.icon}</span>
            {aiInferred && (
              <span title="AI 推断" style={{
                position: 'absolute', top: -4, right: -4, fontSize: 9, background: '#fff',
                borderRadius: '50%', border: '1px solid var(--mt-border)', width: 15, height: 15,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>🤖</span>
            )}
          </div>
        </div>
      )}

      {/* ── Faction: Rounded rectangle (Maltego "entity set") ── */}
      {isFaction && (
        <div style={{
          width: dim + 8, height: dim - 4, borderRadius: 8,
          background: `linear-gradient(135deg, ${config.color}, ${shade(config.color, -15)})`,
          border: '2px solid #ffffff',
          boxShadow: selected
            ? `0 0 0 1px ${config.color}, 0 3px 10px ${config.color}55`
            : '0 2px 6px rgba(0,0,0,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, lineHeight: 1, position: 'relative',
        }}>
          <span style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.3))' }}>{config.icon}</span>
        </div>
      )}

      {/* ── Event: Hexagon ── */}
      {isEvent && (
        <div style={{
          width: dim, height: dim, position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width={dim} height={dim} style={{ position: 'absolute', top: 0, left: 0 }}>
            <polygon
              points={hexPoints(dim / 2, dim / 2, dim / 2 - 2)}
              fill={`url(#eventGrad-${entity.id})`}
              stroke="#fff" strokeWidth={2}
            />
            <defs>
              <linearGradient id={`eventGrad-${entity.id}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={config.color} />
                <stop offset="100%" stopColor={shade(config.color, -18)} />
              </linearGradient>
            </defs>
          </svg>
          <span style={{ fontSize: 18, lineHeight: 1, zIndex: 1, filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.3))' }}>{config.icon}</span>
        </div>
      )}

      {/* ── Location / Item: Diamond ── */}
      {!isChar && !isFaction && !isEvent && (
        <div style={{
          width: dim, height: dim, position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width={dim} height={dim} style={{ position: 'absolute', top: 0, left: 0 }}>
            <polygon
              points={`${dim/2},2 ${dim-2},${dim/2} ${dim/2},${dim-2} 2,${dim/2}`}
              fill={config.color}
              stroke="#fff" strokeWidth={2}
            />
          </svg>
          <span style={{ fontSize: 16, lineHeight: 1, zIndex: 1, filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.3))' }}>{config.icon}</span>
        </div>
      )}

      {/* ── Label ── */}
      <div style={{
        marginTop: isChar ? 5 : 3,
        maxWidth: isChar ? 120 : 90,
        textAlign: 'center',
        fontSize: isChar ? 12 : 10,
        color: 'var(--mt-text)',
        lineHeight: 1.2,
        wordBreak: 'break-word',
        fontWeight: selected ? 700 : isChar ? 600 : 400,
        textShadow: '0 1px 2px #fff, 0 0 2px #fff',
      }}>
        {entity.name}
      </div>

      {isChar && entity.properties?.goal && (
        <div style={{
          marginTop: 2, fontSize: 8, color: config.color,
          maxWidth: 100, textAlign: 'center', lineHeight: 1.1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          opacity: 0.75,
        }}>
          {String(entity.properties.goal).slice(0, 20)}
        </div>
      )}

      {/* Handles */}
      <Handle type="source" position={Position.Top} id="c" style={centerHandle} />
      <Handle type="target" position={Position.Top} id="c-t" style={centerHandle} />
      <Handle type="source" position={Position.Bottom} id="port" style={portStyle} />
    </div>
  );
}

/** Hexagon points for SVG polygon */
function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(' ');
}

/** Get faction colour from entity's member_of relation (heuristic from properties) */
function getFactionColor(entity: Entity): string | null {
  // We check if the entity has faction info in properties
  // This is a lightweight heuristic — the real faction comes from relations
  const faction = entity.properties?.faction;
  if (faction === 'Spica' || faction === 'スピカ班') return '#3a7bd5';
  if (faction === 'Rigil' || faction === 'リギル班') return '#d24b43';
  if (faction === 'Canaan' || faction === 'カナン班') return '#2faa5e';
  return null;
}

/** Darken a hex color by pct (negative = darker) */
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
