/**
 * Client-side visibility model — mirrors backend app/graph/visibility.py.
 * Used by the canvas "View as / 以…视角" mode to render fog of war over the
 * canonical graph (entities an observer cannot see vanish; private properties
 * are hidden on the node card).
 */
import { VISIBILITY_KEY, PROP_VISIBILITY_KEY } from './propertyOrder';

export type VisMeta = {
  mode: 'public' | 'groups' | 'predicate';
  groups?: string[];
  predicate?: { key: string; op: string; value: unknown };
};
export type PropVisRule = { level: 'public' | 'private' | 'entities'; entities?: string[] };

type EntityLike = { id: string; type: string; properties?: Record<string, unknown> };
type RelationLike = { source_id: string; target_id: string; type: string };
type TagLike = { id: string; entityIds: string[] };

function visMeta(e: EntityLike): VisMeta | null {
  return (e.properties?.[VISIBILITY_KEY] as VisMeta) || null;
}

export function belongsToGroup(
  observerId: string, groupId: string, relations: RelationLike[], tags: TagLike[],
): boolean {
  if (!observerId || !groupId) return false;
  for (const r of relations) {
    if (r.type === 'member_of' && r.source_id === observerId && r.target_id === groupId) return true;
  }
  const tag = tags.find((t) => t.id === groupId);
  if (tag && tag.entityIds.includes(observerId)) return true;
  return false;
}

function evalPredicate(observer: EntityLike | undefined, pred: VisMeta['predicate']): boolean {
  if (!observer || !pred) return false;
  const actual = observer.properties?.[pred.key];
  const op = (pred.op || 'eq').toLowerCase();
  if (op === 'exists' || op === 'has') return actual != null && actual !== '' ;
  if (actual == null) return false;
  const v = pred.value;
  if (op === 'eq') return String(actual) === String(v);
  if (op === 'ne') return String(actual) !== String(v);
  if (op === 'contains') {
    if (Array.isArray(actual)) return actual.map(String).includes(String(v));
    return String(actual).includes(String(v));
  }
  const a = Number(actual), b = Number(v);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  if (op === 'gt') return a > b;
  if (op === 'lt') return a < b;
  if (op === 'gte') return a >= b;
  if (op === 'lte') return a <= b;
  return false;
}

export function entityVisibleTo(
  entity: EntityLike, observerId: string | null,
  entities: EntityLike[], relations: RelationLike[], tags: TagLike[],
): boolean {
  if (!observerId) return true;            // omniscient
  if (entity.id === observerId) return true;
  const meta = visMeta(entity);
  if (!meta || meta.mode === 'public') return true;
  if (meta.mode === 'groups') {
    return (meta.groups || []).some((g) => belongsToGroup(observerId, g, relations, tags));
  }
  if (meta.mode === 'predicate') {
    const observer = entities.find((e) => e.id === observerId);
    return evalPredicate(observer, meta.predicate);
  }
  return true;
}

export function propertyVisibleTo(
  entity: EntityLike, key: string, observerId: string | null,
): boolean {
  if (!observerId) return true;
  if (entity.id === observerId) return true;
  const rule = (entity.properties?.[PROP_VISIBILITY_KEY] as Record<string, PropVisRule>)?.[key];
  if (!rule || rule.level === 'public') return true;
  if (rule.level === 'private') return false;
  if (rule.level === 'entities') return (rule.entities || []).includes(observerId);
  return true;
}

/** Set of entity ids the observer can see (null observer = all). */
export function computeVisibleEntityIds(
  observerId: string | null,
  entities: EntityLike[], relations: RelationLike[], tags: TagLike[],
): Set<string> {
  return new Set(
    entities
      .filter((e) => entityVisibleTo(e, observerId, entities, relations, tags))
      .map((e) => e.id),
  );
}
