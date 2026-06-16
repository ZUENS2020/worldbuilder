/**
 * Lightweight force-directed simulation (Maltego-style "organic" graph).
 *
 * Physics each tick:
 *   - Charge: every pair of nodes repels (Coulomb, ~1/d²).
 *   - Links:  edges act as springs pulling toward a rest length.
 *   - Center: a gentle pull toward the graph centre keeps it on-screen.
 *   - Collision: short-range push so balls don't overlap.
 * Velocities are damped and `alpha` (energy) decays so the graph settles,
 * then stops. Dragging a node pins it and re-heats the simulation so the
 * rest of the graph reacts in real time.
 */

export interface SimNode { id: string; x: number; y: number; vx: number; vy: number; fixed: boolean; type?: string }
export interface SimLink { source: string; target: string }

const REPULSION = 3500;     // charge strength (lower = less scatter)
const LINK_DIST = 200;      // spring rest length
const LINK_STRENGTH = 0.12; // spring stiffness (higher = tighter clusters)
const CENTER_STRENGTH = 0.008;
const COLLIDE_R = 80;       // min distance between node centres
const DAMPING = 0.88;
const ALPHA_DECAY = 0.012;
const ALPHA_MIN = 0.005;
const MAX_VEL = 25;
const TYPE_BIAS = 0.004;    // same-type weak attraction

export class ForceSimulation {
  nodes = new Map<string, SimNode>();
  links: SimLink[] = [];
  alpha = 1;
  center = { x: 600, y: 460 };

  /** Sync the node set + links, preserving velocities of existing nodes. */
  setData(positions: { id: string; x: number; y: number; type?: string }[], links: SimLink[], center?: { x: number; y: number }) {
    if (center) this.center = center;
    const next = new Map<string, SimNode>();
    let added = false;
    for (const p of positions) {
      const existing = this.nodes.get(p.id);
      if (existing) {
        existing.type = p.type;
        next.set(p.id, existing);
      } else {
        added = true;
        // Seed new nodes near the centre with a small random offset.
        next.set(p.id, {
          id: p.id,
          type: p.type,
          x: Number.isFinite(p.x) ? p.x : this.center.x + (Math.random() - 0.5) * 120,
          y: Number.isFinite(p.y) ? p.y : this.center.y + (Math.random() - 0.5) * 120,
          vx: 0, vy: 0, fixed: false,
        });
      }
    }
    this.nodes = next;
    this.links = links.filter((l) => next.has(l.source) && next.has(l.target));
    if (added) this.reheat();
  }

  reheat(value = 1) { this.alpha = Math.max(this.alpha, value); }

  setFixed(id: string, x: number, y: number) {
    const n = this.nodes.get(id);
    if (n) { n.fixed = true; n.x = x; n.y = y; n.vx = 0; n.vy = 0; }
  }
  clearFixed(id: string) {
    const n = this.nodes.get(id);
    if (n) n.fixed = false;
  }

  get(id: string) { return this.nodes.get(id); }

  /** Advance one step. Returns true while the graph is still moving. */
  tick(): boolean {
    if (this.alpha < ALPHA_MIN) return false;
    const arr = Array.from(this.nodes.values());
    const a = this.alpha;

    // Pairwise repulsion + collision
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const p = arr[i], q = arr[j];
        let dx = p.x - q.x, dy = p.y - q.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = dx * dx + dy * dy; }
        const d = Math.sqrt(d2);
        let f = (REPULSION / d2) * a;
        // Extra short-range push to resolve overlaps
        if (d < COLLIDE_R) f += ((COLLIDE_R - d) * 0.5) * a;
        const ux = dx / d, uy = dy / d;
        if (!p.fixed) { p.vx += ux * f; p.vy += uy * f; }
        if (!q.fixed) { q.vx -= ux * f; q.vy -= uy * f; }
      }
    }

    // Link springs
    for (const l of this.links) {
      const s = this.nodes.get(l.source)!, t = this.nodes.get(l.target)!;
      const dx = t.x - s.x, dy = t.y - s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - LINK_DIST) * LINK_STRENGTH * a;
      const ux = dx / d, uy = dy / d;
      if (!s.fixed) { s.vx += ux * f; s.vy += uy * f; }
      if (!t.fixed) { t.vx -= ux * f; t.vy -= uy * f; }
    }

    // Same-type weak attraction: characters cluster together, etc.
    if (TYPE_BIAS > 0) {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const p = arr[i], q = arr[j];
          if (p.type && p.type === q.type && p.type !== 'character') continue; // only cluster characters
          if (!p.type || p.type !== q.type) continue;
          const dx = q.x - p.x, dy = q.y - p.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          if (d < LINK_DIST * 2) continue; // already close enough
          const f = TYPE_BIAS * a;
          const ux = dx / d, uy = dy / d;
          if (!p.fixed) { p.vx += ux * f; p.vy += uy * f; }
          if (!q.fixed) { q.vx -= ux * f; q.vy -= uy * f; }
        }
      }
    }

    // Centering + integrate
    for (const n of arr) {
      if (n.fixed) continue;
      n.vx += (this.center.x - n.x) * CENTER_STRENGTH * a;
      n.vy += (this.center.y - n.y) * CENTER_STRENGTH * a;
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.vx = Math.max(-MAX_VEL, Math.min(MAX_VEL, n.vx));
      n.vy = Math.max(-MAX_VEL, Math.min(MAX_VEL, n.vy));
      n.x += n.vx;
      n.y += n.vy;
    }

    this.alpha *= 1 - ALPHA_DECAY;
    return true;
  }
}
