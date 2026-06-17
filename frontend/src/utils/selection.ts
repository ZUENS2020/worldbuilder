/** Ray-casting point-in-polygon test (screen / flow coords). */
export function pointInPolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Merge or replace selection depending on modifier keys. */
export function mergeSelection(
  current: string[],
  incoming: string[],
  additive: boolean,
): string[] {
  if (!additive) return incoming;
  const merged = new Set(current);
  for (const id of incoming) merged.add(id);
  return [...merged];
}

export function pointInRect(
  point: { x: number; y: number },
  rect: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  const minX = Math.min(rect.x1, rect.x2);
  const maxX = Math.max(rect.x1, rect.x2);
  const minY = Math.min(rect.y1, rect.y2);
  const maxY = Math.max(rect.y1, rect.y2);
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}
