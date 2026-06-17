/** Internal key storing custom property display order. */
export const PROPERTY_ORDER_KEY = '_property_order';

export const RESERVED_ENTITY_PROPERTY_KEYS = new Set(['name', 'label', PROPERTY_ORDER_KEY]);

export function getOrderedPropertyEntries(
  properties: Record<string, unknown> | undefined,
): [string, unknown][] {
  const props = properties || {};
  const keys = Object.keys(props).filter((k) => !RESERVED_ENTITY_PROPERTY_KEYS.has(k));
  const rawOrder = props[PROPERTY_ORDER_KEY];
  const order = Array.isArray(rawOrder) ? (rawOrder as string[]).filter((k) => typeof k === 'string') : [];
  const ordered = order.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !ordered.includes(k));
  return [...ordered, ...rest].map((k) => [k, props[k]]);
}

export function buildPropertiesWithOrder(
  entries: [string, unknown][],
  base: Record<string, unknown> = {},
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  const keys: string[] = [];
  for (const [k, v] of entries) {
    next[k] = v;
    keys.push(k);
  }
  next[PROPERTY_ORDER_KEY] = keys;
  for (const k of RESERVED_ENTITY_PROPERTY_KEYS) {
    if (k !== PROPERTY_ORDER_KEY && k in base) next[k] = base[k];
  }
  return next;
}

export function reorderPropertyEntries(
  entries: [string, unknown][],
  from: number,
  to: number,
): [string, unknown][] {
  if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) {
    return entries;
  }
  const next = [...entries];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
