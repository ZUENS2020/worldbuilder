import { memo } from 'react';
import { BaseEdge, getStraightPath, type EdgeProps } from '@xyflow/react';
import { getRelationConfig } from '../../types';
import { useAppStore } from '../../stores/appStore';

/**
 * OSINT-style edge, optimized for character-driven narrative.
 *
 * Uses getRelationConfig() to merge built-in + custom relation types
 * so that user-defined types render with their chosen color/style/label.
 */
function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: EdgeProps) {
  const customRelationTypes = useAppStore((s) => s.customRelationTypes);
  const relType = data?.relationType as string || 'ally';
  const allConfig = getRelationConfig(customRelationTypes);
  const config = allConfig[relType] || { color: '#666', style: 'solid', label: relType };

  // Determine edge category by the types of connected nodes
  // (We use a heuristic: "member_of" and "located_at" are infrastructure links)
  const isInfraLink = relType === 'located_at';
  const isAffilLink = relType === 'member_of';
  const isEventLink = relType === 'participated';
  const isCharLink = !isInfraLink && !isAffilLink && !isEventLink;

  // Visual weight based on category
  const strokeWidth = selected
    ? 3
    : isCharLink
      ? 2.2
      : isAffilLink
        ? 1.6
        : isEventLink
          ? 1.2
          : 0.8;  // located_at: faintest

  const opacity = selected
    ? 1
    : isInfraLink
      ? 0.3
      : isEventLink
        ? 0.5
        : isAffilLink
          ? 0.65
          : 0.85;

  // Dash pattern
  let strokeDasharray: string | undefined;
  if (config.style === 'dashed') strokeDasharray = '8 4';
  else if (config.style === 'dotted') strokeDasharray = '3 4';
  else if (isEventLink) strokeDasharray = '4 4';
  else if (isInfraLink) strokeDasharray = '2 6';

  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  // Only show label for character links or selected; infrastructure links hide labels
  const showLabel = isCharLink || isAffilLink || selected;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? 'var(--mt-accent)' : config.color,
          strokeWidth,
          strokeDasharray,
          opacity,
          transition: 'opacity 0.15s, stroke-width 0.15s',
        }}
      />
      {showLabel && (
        <text
          x={(sourceX + targetX) / 2}
          y={(sourceY + targetY) / 2 - 6}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={isCharLink ? 10 : 9}
          fontWeight={isCharLink ? 600 : 400}
          fill={selected ? 'var(--mt-accent)' : config.color}
          stroke="#ffffff"
          strokeWidth={3}
          paintOrder="stroke"
          opacity={selected ? 1 : isCharLink ? 0.9 : 0.7}
          style={{ pointerEvents: 'none' }}
        >
          {config.label}
        </text>
      )}
    </>
  );
}

export default memo(RelationEdge);
