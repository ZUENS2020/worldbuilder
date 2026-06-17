// Entity types and their visual config
export type EntityType = 'character' | 'location' | 'event' | 'item' | 'faction';

export type RelationType = 'ally' | 'enemy' | 'lover' | 'family' | 'rival' | 'mentor' | 'subordinate' | 'member_of' | 'located_at' | 'participated' | 'caused' | 'followed_by' | 'holds' | 'owns' | 'custom';

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  properties: Record<string, any>;
  project_id: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface Relation {
  id: string;
  source_id: string;
  target_id: string;
  type: RelationType;
  properties: Record<string, any>;
  weight: number;
  project_id: string;
}

export interface GraphHopSettings {
  transform_expand: number;
  transform_enemy: number;
  ai_context: number;
  context_injection: number;  // ST 插件 / 外部对话上下文
  isolate_subgraph: number;
}

export const DEFAULT_GRAPH_HOPS: GraphHopSettings = {
  transform_expand: 1,
  transform_enemy: 2,
  ai_context: 1,
  context_injection: 2,
  isolate_subgraph: 2,
};

const MIN_HOP = 1;
const MAX_HOP = 5;

function clampHop(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(MIN_HOP, Math.min(MAX_HOP, n));
}

/** Merge project.settings.graph_hops with defaults (mirrors backend hop_settings.py). */
export function getGraphHops(project?: Project | null): GraphHopSettings {
  const merged = { ...DEFAULT_GRAPH_HOPS };
  const raw = project?.settings?.graph_hops;
  if (raw && typeof raw === 'object') {
    const hops = raw as Record<string, unknown>;
    if ('writing_context' in hops && !('context_injection' in hops)) {
      hops.context_injection = hops.writing_context;
    }
    for (const key of Object.keys(DEFAULT_GRAPH_HOPS) as (keyof GraphHopSettings)[]) {
      if (key in hops) merged[key] = clampHop(hops[key], merged[key]);
    }
  }
  return merged;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  settings: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface TransformDef {
  id: string;
  label: string;
  description: string;
}

export interface TransformResult {
  new_entities: Entity[];
  new_relations: Relation[];
  message: string;
}

export interface GraphContext {
  system_injection: string;
  active_warnings: string[];
  token_count: number;
}

// Custom tag (folder) for user-defined grouping in the palette
export interface Tag {
  id: string;
  name: string;
  color: string;
  entityIds: string[];
}

// Color palette for custom tags (folders)
export const TAG_COLORS = [
  '#3a7bd5', '#2faa5e', '#e08a1e', '#8e5cc4', '#d24b43',
  '#00bcd4', '#ff9800', '#795548', '#607d8b', '#e91e63',
];

// Custom relation type (user-defined, persisted in Project.settings.customRelationTypes)
export interface CustomRelationType {
  id: string;
  name: string;
  color: string;
  style: 'solid' | 'dashed' | 'dotted';
}

/** Merge built-in RELATION_CONFIG with custom types. Custom types use their id as the key. */
export function getRelationConfig(customTypes?: CustomRelationType[]): Record<string, { color: string; style: string; label: string }> {
  const merged: Record<string, { color: string; style: string; label: string }> = { ...RELATION_CONFIG };
  if (customTypes) {
    for (const ct of customTypes) {
      merged[ct.id] = { color: ct.color, style: ct.style, label: ct.name };
    }
  }
  return merged;
}

// Visual config per entity type (Maltego-style palette)
// Characters are the PRIMARY nodes — bigger, more prominent.
// Factions/events/locations are SECONDARY — smaller, satellite.
export const ENTITY_CONFIG: Record<EntityType, { color: string; icon: string; label: string; size: number; shape: 'circle' | 'diamond' | 'hexagon' | 'rect' }> = {
  character: { color: '#3a7bd5', icon: '👤', label: '人物', size: 62, shape: 'circle' },
  location:  { color: '#2faa5e', icon: '📍', label: '地点', size: 44, shape: 'diamond' },
  event:     { color: '#e08a1e', icon: '⚡', label: '事件', size: 44, shape: 'hexagon' },
  item:      { color: '#8e5cc4', icon: '💎', label: '物品', size: 44, shape: 'diamond' },
  faction:   { color: '#d24b43', icon: '⚔️', label: '阵营', size: 50, shape: 'rect' },
};

// Entity types grouped into palette categories (like Maltego's Entity Palette)
export const PALETTE_CATEGORIES: { name: string; types: EntityType[] }[] = [
  { name: '角色 People', types: ['character'] },
  { name: '世界 World', types: ['location', 'faction'] },
  { name: '叙事 Narrative', types: ['event', 'item'] },
];

// Visual config per relation type
export const RELATION_CONFIG: Record<string, { color: string; style: string; label: string }> = {
  ally:        { color: '#2ECC71', style: 'solid',  label: '盟友' },
  enemy:       { color: '#E74C3C', style: 'dashed', label: '敌对' },
  lover:       { color: '#E91E63', style: 'solid',  label: '恋人' },
  family:      { color: '#FF9800', style: 'solid',  label: '家族' },
  rival:       { color: '#FF5722', style: 'dashed', label: '对手' },
  mentor:      { color: '#00BCD4', style: 'solid',  label: '师徒' },
  subordinate: { color: '#795548', style: 'solid',  label: '从属' },
  member_of:   { color: '#9C27B0', style: 'solid',  label: '属于' },
  located_at:  { color: '#4CAF50', style: 'dotted', label: '位于' },
  participated:{ color: '#FF9800', style: 'dotted', label: '参与' },
  caused:      { color: '#F44336', style: 'solid',  label: '导致' },
  followed_by: { color: '#03A9F4', style: 'dotted', label: '随后' },
  holds:       { color: '#9B59B6', style: 'solid',  label: '持有' },
  owns:        { color: '#8BC34A', style: 'solid',  label: '拥有' },
};
