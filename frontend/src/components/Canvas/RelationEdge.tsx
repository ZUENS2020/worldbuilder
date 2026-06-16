import { memo } from 'react';
import { BaseEdge, getStraightPath, type EdgeProps } from '@xyflow/react';
import { RELATION_CONFIG } from '../../types';

// Maltego-style straight radial "spoke" edge with a midpoint label.
function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: EdgeProps) {
  const relType = data?.relationType as string || 'ally';
  const config = RELATION_CONFIG[relType] || { color: '#666', style: 'solid', label: relType };

  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? 'var(--mt-accent)' : config.color,
          strokeWidth: selected ? 2.5 : 1.4,
          strokeDasharray: config.style === 'dashed' ? '7 4' : config.style === 'dotted' ? '2 3' : undefined,
          opacity: selected ? 1 : 0.85,
        }}
      />
      {/* Relation type label at midpoint */}
      <text
        x={(sourceX + targetX) / 2}
        y={(sourceY + targetY) / 2 - 6}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={10}
        fontWeight={500}
        fill={config.color}
        stroke="#ffffff"
        strokeWidth={3.5}
        paintOrder="stroke"
        style={{ pointerEvents: 'none' }}
      >
        {config.label}
      </text>
    </>
  );
}

export default memo(RelationEdge);
