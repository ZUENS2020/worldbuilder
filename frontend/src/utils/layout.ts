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
  'elk.spacing.nodeNode': '60',
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
 * Maltego-style radial topology: characters at the core, with their
 * connected factions/events/locations fanning out in outer rings.
 *
 * Layout strategy (character-centric):
 *   - Ring 0 (centre): the most-connected character (or selected focus)
 *   - Ring 1: other characters, arranged by shared connections
 *   - Ring 2: factions, events, locations connected to ring-1 characters
 *
 * Characters in the same faction are grouped into angular wedges so
 * their affiliated faction node sits behind them (like a fan).
 */
const RING_GAP = 260;
const CENTER = { x: 800, y: 600 };

export function radialLayout(nodes: Node[], edges: Edge[], focusId?: string): Node[] {
  if (nodes.length === 0) return nodes;
  if (nodes.length === 1) return [{ ...nodes[0], position: { ...CENTER } }];

  // Categorise nodes by type
  const byId = new Map<string, Node>();
  const typeOf = new Map<string, string>();
  nodes.forEach((n) => {
    byId.set(n.id, n);
    typeOf.set(n.id, (n.data?.entity as any)?.type || 'character');
  });

  // Build adjacency (undirected)
  const adj = new Map<string, string[]>();
  nodes.forEach((n) => adj.set(n.id, []));
  edges.forEach((e) => {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.push(e.target);
      adj.get(e.target)!.push(e.source);
    }
  });

  // ── Step 1: Pick the central character ──
  // Prefer explicit focus, else the most-connected character.
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
  // Fallback: most connected node of any type
  if (!root) {
    let best = -1;
    for (const n of nodes) {
      const d = adj.get(n.id)!.length;
      if (d > best) { best = d; root = n.id; }
    }
  }
  if (!root) root = nodes[0].id;

  // ── Step 2: BFS to assign hop levels (character-centric) ──
  // Characters go to ring 1, their non-character neighbours to ring 2.
  const level = new Map<string, number>();
  const parent = new Map<string, string>();
  const visited = new Set<string>([root]);
  level.set(root, 0);

  const queue = [root];
  while (queue.length) {
    const u = queue.shift()!;
    const uLevel = level.get(u)!;
    const uType = typeOf.get(u);

    // Sort neighbours: characters first (so they stay in inner rings)
    const neighbours = adj.get(u)!;
    const sorted = [...neighbours].sort((a, b) => {
      const ta = typeOf.get(a), tb = typeOf.get(b);
      if (ta === 'character' && tb !== 'character') return -1;
      if (ta !== 'character' && tb === 'character') return 1;
      return 0;
    });

    for (const v of sorted) {
      if (visited.has(v)) continue;
      visited.add(v);
      parent.set(v, u);

      const vType = typeOf.get(v);
      // Characters at same or next ring, non-characters pushed one ring further
      if (vType === 'character') {
        level.set(v, uLevel + 1);
      } else {
        level.set(v, Math.max(uLevel + 1, uLevel + 2));
        // Simplify: faction/event/location always 1 ring further than their character
        if (uType === 'character') {
          level.set(v, uLevel + 2);
        }
      }
      queue.push(v);
    }
  }

  // Disconnected nodes: attach to root at ring 2
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      visited.add(n.id);
      level.set(n.id, 2);
      parent.set(n.id, root);
    }
  }

  // ── Step 3: Group characters by faction (angular wedges) ──
  // Find faction membership for each character
  const charFaction = new Map<string, string>(); // charId -> factionId
  edges.forEach((e) => {
    const sType = typeOf.get(e.source), tType = typeOf.get(e.target);
    if (sType === 'character' && tType === 'faction') charFaction.set(e.source, e.target);
    if (tType === 'character' && sType === 'faction') charFaction.set(e.target, e.source);
  });

  // Group ring-1 characters by faction
  const ring1Chars = nodes.filter((n) => level.get(n.id) === 1 && typeOf.get(n.id) === 'character');
  const factionGroups = new Map<string, string[]>(); // factionId -> [charIds]
  const noFaction: string[] = [];
  for (const c of ring1Chars) {
    const f = charFaction.get(c.id);
    if (f) {
      factionGroups.set(f, [...(factionGroups.get(f) || []), c.id]);
    } else {
      noFaction.push(c.id);
    }
  }

  // ── Step 4: Assign angles ──
  const angle = new Map<string, number>();

  // Root at centre (angle irrelevant)
  angle.set(root, 0);

  // Allocate angular wedges: each faction group gets a wedge, ungrouped chars fill gaps
  const allGroups: { id: string; members: string[]; isFaction: boolean }[] = [];
  for (const [fid, members] of factionGroups) {
    allGroups.push({ id: fid, members, isFaction: true });
  }
  if (noFaction.length > 0) {
    allGroups.push({ id: '_none', members: noFaction, isFaction: false });
  }

  const totalWeight = allGroups.reduce((s, g) => s + g.members.length, 0) || 1;
  let currentAngle = 0;

  for (const group of allGroups) {
    const wedge = (2 * Math.PI * group.members.length) / totalWeight;
    const perMember = wedge / group.members.length;

    for (let i = 0; i < group.members.length; i++) {
      const a = currentAngle + perMember * (i + 0.5);
      angle.set(group.members[i], a);
    }

    // Place the faction node at the centre of its wedge (one ring further)
    if (group.isFaction) {
      angle.set(group.id, currentAngle + wedge / 2);
    }

    currentAngle += wedge;
  }

  // For ring-2+ non-character nodes not yet assigned: place near their parent
  for (const n of nodes) {
    if (angle.has(n.id)) continue;
    const p = parent.get(n.id);
    if (p && angle.has(p)) {
      // Spread siblings evenly around the parent's angle
      const siblings = nodes.filter((s) => parent.get(s.id) === p && !angle.has(s.id));
      const idx = siblings.indexOf(n);
      const base = angle.get(p)!;
      const spread = 0.4; // radians
      const offset = siblings.length > 1
        ? -spread / 2 + (spread * idx) / (siblings.length - 1)
        : 0;
      angle.set(n.id, base + offset);
    } else {
      // Fallback: even distribution
      const unassigned = nodes.filter((s) => !angle.has(s.id));
      const idx = unassigned.indexOf(n);
      angle.set(n.id, (2 * Math.PI * idx) / Math.max(unassigned.length, 1));
    }
  }

  // ── Step 5: Compute positions ──
  return nodes.map((n) => {
    const lvl = level.get(n.id) ?? 1;
    const ang = angle.get(n.id) ?? 0;
    if (lvl === 0) return { ...n, position: { ...CENTER } };
    // Non-characters at same logical level get pushed one ring further
    const ring = typeOf.get(n.id) === 'character' ? lvl : Math.max(lvl, lvl + 0.5);
    return {
      ...n,
      position: {
        x: CENTER.x + ring * RING_GAP * Math.cos(ang),
        y: CENTER.y + ring * RING_GAP * Math.sin(ang),
      },
    };
  });
}
