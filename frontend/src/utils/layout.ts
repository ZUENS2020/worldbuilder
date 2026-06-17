/**
 * ELKjs layout utilities for auto-arranging graph nodes.
 * Supports: hierarchical (layered) and force-directed layouts.
 */

import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { Node, Edge } from '@xyflow/react';

const elk = new ELK();

const HIERARCHICAL_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.spacing.nodeNode': '50',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.direction': 'RIGHT',
};

const FORCE_OPTIONS = {
  'elk.algorithm': 'force',
  'elk.spacing.nodeNode': '110',
  'elk.force.temperature': '0.001',
  'elk.force.iterations': '300',
  'elk.force.model': 'FRUCHTERMAN_REINGOLD',
};

export type LayoutType = 'hierarchical' | 'force' | 'radial';

export async function calculateLayout(
  nodes: Node[],
  edges: Edge[],
  layoutType: LayoutType = 'radial',
  focusId?: string,
): Promise<Node[]> {
  if (nodes.length === 0) return nodes;

  // Radial layout is computed locally (Maltego-style concentric rings).
  if (layoutType === 'radial') {
    return radialLayout(nodes, edges, focusId);
  }

  const elkOptions = layoutType === 'hierarchical' ? HIERARCHICAL_OPTIONS : FORCE_OPTIONS;

  // Build ELK graph
  const elkNode: ElkNode = {
    id: 'root',
    layoutOptions: elkOptions,
    children: nodes.map((node) => ({
      id: node.id,
      width: 80,
      height: 80,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  try {
    const layoutedGraph = await elk.layout(elkNode);

    // Map layouted positions back to ReactFlow nodes
    const positionMap = new Map<string, { x: number; y: number }>();
    layoutedGraph.children?.forEach((child) => {
      if (child.x !== undefined && child.y !== undefined) {
        positionMap.set(child.id, { x: child.x, y: child.y });
      }
    });

    return nodes.map((node) => {
      const pos = positionMap.get(node.id);
      return pos ? { ...node, position: pos } : node;
    });
  } catch (e) {
    console.error('ELK layout failed:', e);
    return nodes;
  }
}

/**
 * Maltego-style radial topology: the most-connected character (or focus)
 * sits at the centre; every other node is placed on a concentric ring by
 * its BFS hop distance.
 *
 * Two ideas keep it clean even with many nodes:
 *   1. Adaptive ring radius — a ring's radius grows with how many nodes it
 *      holds, so adjacent nodes always keep an arc length ≥ MIN_ARC. This
 *      removes overlaps by construction (no post-hoc shoving needed).
 *   2. Barycentre ordering — ring by ring, nodes are ordered by the mean
 *      angle of their already-placed neighbours in the inner ring, so
 *      children sit near their parents and edge crossings drop sharply.
 */
const RING_GAP = 260;
const MIN_ARC = 160; // minimum arc length (centre-to-centre) between ring neighbours
const CENTER = { x: 800, y: 600 };

export function radialLayout(nodes: Node[], edges: Edge[], focusId?: string): Node[] {
  if (nodes.length === 0) return nodes;
  if (nodes.length === 1) return [{ ...nodes[0], position: { ...CENTER } }];

  const typeOf = new Map<string, string>();
  nodes.forEach((n) => typeOf.set(n.id, (n.data?.entity as any)?.type || 'character'));

  // Build adjacency (undirected)
  const adj = new Map<string, string[]>();
  nodes.forEach((n) => adj.set(n.id, []));
  edges.forEach((e) => {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }
  });

  // ── Step 1: Pick the central node (focus, else most-connected character) ──
  let root: string | undefined;
  if (focusId && adj.has(focusId)) {
    root = focusId;
  } else {
    let best = -1;
    for (const n of nodes) {
      if (typeOf.get(n.id) !== 'character') continue;
      const d = adj.get(n.id)!.length;
      if (d > best) { best = d; root = n.id; }
    }
  }
  if (!root) {
    let best = -1;
    for (const n of nodes) {
      const d = adj.get(n.id)!.length;
      if (d > best) { best = d; root = n.id; }
    }
  }
  if (!root) root = nodes[0].id;

  // ── Step 2: BFS hop levels → ring number ──
  // Characters keep their BFS hop; non-characters are pushed one ring out so
  // events/locations/factions never share a ring with the characters they hang off.
  const ring = new Map<string, number>();
  const visited = new Set<string>([root]);
  ring.set(root, 0);

  const queue = [root];
  while (queue.length) {
    const u = queue.shift()!;
    const uRing = ring.get(u)!;
    // Characters first so they settle into the inner rings.
    const sorted = [...adj.get(u)!].sort((a, b) => {
      const ta = typeOf.get(a), tb = typeOf.get(b);
      if (ta === 'character' && tb !== 'character') return -1;
      if (ta !== 'character' && tb === 'character') return 1;
      return 0;
    });
    for (const v of sorted) {
      if (visited.has(v)) continue;
      visited.add(v);
      const vRing = typeOf.get(v) === 'character' ? uRing + 1 : uRing + 2;
      ring.set(v, Math.max(1, vRing));
      queue.push(v);
    }
  }
  // Disconnected nodes go to an outer ring.
  let maxRing = 0;
  ring.forEach((r) => { if (r > maxRing) maxRing = r; });
  for (const n of nodes) {
    if (!visited.has(n.id)) { ring.set(n.id, maxRing + 1); visited.add(n.id); }
  }

  // ── Step 3: Bucket nodes by ring ──
  const ringBuckets = new Map<number, string[]>();
  for (const n of nodes) {
    if (n.id === root) continue;
    const r = ring.get(n.id) ?? 1;
    if (!ringBuckets.has(r)) ringBuckets.set(r, []);
    ringBuckets.get(r)!.push(n.id);
  }

  // ── Step 4 & 5: order each ring by neighbour barycentre, place on circle ──
  const angle = new Map<string, number>();
  angle.set(root, 0);
  const radiusOf = new Map<string, number>();

  const sortedRings = [...ringBuckets.keys()].sort((a, b) => a - b);
  for (const r of sortedRings) {
    const ids = ringBuckets.get(r)!;
    // Barycentre = mean angle of already-placed neighbours (inner rings/root).
    const bary = (id: string): number => {
      const placed = adj.get(id)!.filter((m) => angle.has(m));
      if (placed.length === 0) return Number.POSITIVE_INFINITY; // unanchored → end
      // Average on the unit circle to handle wraparound correctly.
      let sx = 0, sy = 0;
      for (const m of placed) { sx += Math.cos(angle.get(m)!); sy += Math.sin(angle.get(m)!); }
      return Math.atan2(sy, sx);
    };
    const ordered = ids
      .map((id) => ({ id, key: bary(id) }))
      .sort((a, b) => a.key - b.key)
      .map((x) => x.id);

    // Adaptive radius: enough circumference to give each node ≥ MIN_ARC of arc.
    const minCircumference = ordered.length * MIN_ARC;
    const radius = Math.max(r * RING_GAP, minCircumference / (2 * Math.PI));
    const step = (2 * Math.PI) / ordered.length;
    ordered.forEach((id, i) => {
      angle.set(id, i * step);
      radiusOf.set(id, radius);
    });
  }

  // ── Step 6: Compute positions ──
  const positioned = nodes.map((n) => {
    if (n.id === root) return { ...n, position: { ...CENTER } };
    const ang = angle.get(n.id) ?? 0;
    const radius = radiusOf.get(n.id) ?? (ring.get(n.id) ?? 1) * RING_GAP;
    return {
      ...n,
      position: {
        x: CENTER.x + radius * Math.cos(ang),
        y: CENTER.y + radius * Math.sin(ang),
      },
    };
  });

  // Light overlap pass as a safety net (adaptive radius already avoids most).
  return resolveOverlaps(positioned, 3);
}

/**
 * Place a batch of newly-revealed nodes on concentric rings around a pivot
 * position (Maltego-style "Transform expands outward"). Existing occupied
 * positions are taken into account so freshly placed nodes avoid overlapping
 * what is already on the canvas.
 *
 * Returns a map of nodeId → position for the new nodes only.
 */
// Minimum centre-to-centre distance that keeps a node circle + its label pill
// from visually overlapping its neighbour.
const NODE_FOOTPRINT = 185;

export function placeAroundPivot(
  pivot: { x: number; y: number },
  newIds: string[],
  occupied: { x: number; y: number }[] = [],
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (newIds.length === 0) return result;

  const GAP = NODE_FOOTPRINT;
  // Start far enough out that the first ring clears the pivot itself, and grow
  // when the pivot already has occupied neighbours crowding the inner space.
  const nearPivot = occupied.filter((o) => {
    const dx = o.x - pivot.x, dy = o.y - pivot.y;
    return Math.sqrt(dx * dx + dy * dy) < GAP * 2.2;
  }).length;
  const FIRST_RING = GAP + 40 + nearPivot * 12;
  const RING_STEP = GAP + 20;

  // Distribute ids across rings; each ring holds as many as fit at GAP spacing.
  let placed = 0;
  let ring = 1;
  // Rotate the start angle per call so successive expansions don't align.
  const baseAngle = (occupied.length % 16) * (Math.PI / 8);

  while (placed < newIds.length) {
    const radius = FIRST_RING + (ring - 1) * RING_STEP;
    const capacity = Math.max(1, Math.floor((2 * Math.PI * radius) / GAP));
    const count = Math.min(capacity, newIds.length - placed);
    const step = (2 * Math.PI) / count;
    for (let i = 0; i < count; i++) {
      const ang = baseAngle + i * step + (ring % 2) * (step / 2);
      result.set(newIds[placed + i], {
        x: pivot.x + radius * Math.cos(ang),
        y: pivot.y + radius * Math.sin(ang),
      });
    }
    placed += count;
    ring++;
  }

  const newPos = newIds.map((id) => ({ id, position: { ...result.get(id)! } }));

  // ── Phase 1: spring relaxation (new repel new + occupied; new ones move) ──
  for (let pass = 0; pass < 24; pass++) {
    let moved = false;
    for (let i = 0; i < newPos.length; i++) {
      const a = newPos[i];
      for (let j = i + 1; j < newPos.length; j++) {
        const b = newPos[j];
        const dx = a.position.x - b.position.x;
        const dy = a.position.y - b.position.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < GAP) {
          moved = true;
          const push = (GAP - d) / 2 + 1;
          const ux = dx / d, uy = dy / d;
          a.position = { x: a.position.x + ux * push, y: a.position.y + uy * push };
          b.position = { x: b.position.x - ux * push, y: b.position.y - uy * push };
        }
      }
      for (const o of occupied) {
        const dx = a.position.x - o.x;
        const dy = a.position.y - o.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < GAP) {
          moved = true;
          const push = (GAP - d) + 1;
          const ux = dx / d, uy = dy / d;
          a.position = { x: a.position.x + ux * push, y: a.position.y + uy * push };
        }
      }
    }
    if (!moved) break;
  }

  // ── Phase 2: deterministic outward escape — guarantees no overlaps remain ──
  // For any new node still colliding, slide it straight outward from the pivot
  // (where there is always free space) until it clears everything.
  const collides = (p: { x: number; y: number }, self: number): boolean => {
    for (const o of occupied) {
      const dx = p.x - o.x, dy = p.y - o.y;
      if (Math.sqrt(dx * dx + dy * dy) < GAP) return true;
    }
    for (let k = 0; k < newPos.length; k++) {
      if (k === self) continue;
      const dx = p.x - newPos[k].position.x, dy = p.y - newPos[k].position.y;
      if (Math.sqrt(dx * dx + dy * dy) < GAP) return true;
    }
    return false;
  };
  for (let i = 0; i < newPos.length; i++) {
    const a = newPos[i];
    let dirX = a.position.x - pivot.x;
    let dirY = a.position.y - pivot.y;
    let dist = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
    dirX /= dist; dirY /= dist;
    let guard = 0;
    while (collides(a.position, i) && guard < 60) {
      a.position = { x: a.position.x + dirX * (GAP * 0.5), y: a.position.y + dirY * (GAP * 0.5) };
      guard++;
    }
  }

  newPos.forEach((n) => result.set(n.id, n.position));
  return result;
}

/**
 * Iterative overlap resolution: for each pair of nodes that are too close,
 * push them apart along the line connecting them. Runs a few passes.
 * With the adaptive-radius radial layout this is just a final safety net.
 */
function resolveOverlaps(nodes: Node[], passes = 8): Node[] {
  const MIN_GAP = 150; // minimum centre-to-centre distance (node + label pill)
  const result = nodes.map((n) => ({ ...n, position: { ...n.position } }));

  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i], b = result[j];
        const dx = a.position.x - b.position.x;
        const dy = a.position.y - b.position.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < MIN_GAP) {
          moved = true;
          // Push apart equally along the connecting line
          const push = (MIN_GAP - d) / 2 + 2; // +2 for a tiny margin
          const ux = dx / d, uy = dy / d;
          a.position = { x: a.position.x + ux * push, y: a.position.y + uy * push };
          b.position = { x: b.position.x - ux * push, y: b.position.y - uy * push };
        }
      }
    }
    if (!moved) break; // converged
  }
  return result;
}
