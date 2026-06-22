import { memo } from 'react';
import { BaseEdge, getStraightPath, type EdgeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  const customRelationTypes = useAppStore((s) => s.customRelationTypes);
  const relType = data?.relationType as string || 'ally';
  const allConfig = getRelationConfig(customRelationTypes);
  const config = allConfig[relType] || { color: '#666', style: 'solid', label: relType };

  // Transient reveal state (mirrors EntityNode): emphasise edges surfaced by
  // the latest Transform, fade the rest.
  const hl = (data as { hl?: 'on' | 'dim' } | undefined)?.hl;
  const isRevealed = hl === 'on';
  const isDimmed = hl === 'dim';

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

  let opacity = selected
    ? 1
    : isInfraLink
      ? 0.3
      : isEventLink
        ? 0.5
        : isAffilLink
          ? 0.65
          : 0.85;
  if (isRevealed) opacity = 1;
  else if (isDimmed) opacity = 0.1;

  const edgeColor = config.color;
  const lineWidth = isRevealed
    ? Math.max(strokeWidth + 1.2, 3)
    : selected
      ? 3
      : strokeWidth;

  // Dash pattern
  let strokeDasharray: string | undefined;
  if (config.style === 'dashed') strokeDasharray = '8 4';
  else if (config.style === 'dotted') strokeDasharray = '3 4';
  else if (isEventLink) strokeDasharray = '4 4';
  else if (isInfraLink) strokeDasharray = '2 6';

  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  // Only show label for character links or selected; infrastructure links hide labels
  const showLabel = isCharLink || isAffilLink || selected || isRevealed;

  return (
    <>
      {/* Soft glow under expanded edges — keeps the type colour, adds emphasis */}
      {isRevealed && (
        <BaseEdge
          id={`${id}-glow`}
          path={edgePath}
          style={{
            stroke: edgeColor,
            strokeWidth: lineWidth + 5,
            strokeDasharray,
            opacity: 0.22,
            pointerEvents: 'none',
          }}
        />
      )}
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? 'var(--mt-accent)' : edgeColor,
          strokeWidth: lineWidth,
          strokeDasharray,
          opacity,
          transition: 'opacity 0.25s, stroke-width 0.2s',
        }}
      />
      {showLabel && (
        <text
          x={(sourceX + targetX) / 2}
          y={(sourceY + targetY) / 2 - 6}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={isCharLink || isRevealed ? 10 : 9}
          fontWeight={isRevealed || isCharLink ? 700 : 400}
          fill={selected ? 'var(--mt-accent)' : edgeColor}
          stroke="#ffffff"
          strokeWidth={3}
          paintOrder="stroke"
          opacity={isDimmed ? 0.15 : isRevealed || selected ? 1 : isCharLink ? 0.9 : 0.7}
          style={{ pointerEvents: 'none' }}
        >
          {t(config.label)}
        </text>
      )}
    </>
  );
}

export default memo(RelationEdge);
