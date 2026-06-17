/**
 * Undo/redo for canvas node positions (drag, multi-select drag, layout).
 */
import { useCallback, useRef, useState } from 'react';

export type PositionSnapshot = Record<string, { x: number; y: number }>;

const HISTORY_LIMIT = 60;

function snapshotsEqual(a: PositionSnapshot, b: PositionSnapshot): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const pa = a[k];
    const pb = b[k];
    if (!pa || !pb) return false;
    if (Math.abs(pa.x - pb.x) > 0.5 || Math.abs(pa.y - pb.y) > 0.5) return false;
  }
  return true;
}

export function captureNodePositions(
  nodes: { id: string; position: { x: number; y: number } }[],
): PositionSnapshot {
  const snap: PositionSnapshot = {};
  for (const n of nodes) snap[n.id] = { x: n.position.x, y: n.position.y };
  return snap;
}

export function useCanvasHistory() {
  const pastRef = useRef<PositionSnapshot[]>([]);
  const futureRef = useRef<PositionSnapshot[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncFlags = useCallback(() => {
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  const push = useCallback((snapshot: PositionSnapshot) => {
    const last = pastRef.current[pastRef.current.length - 1];
    if (last && snapshotsEqual(last, snapshot)) return;
    pastRef.current = [...pastRef.current, snapshot].slice(-HISTORY_LIMIT);
    futureRef.current = [];
    syncFlags();
  }, [syncFlags]);

  const clear = useCallback(() => {
    pastRef.current = [];
    futureRef.current = [];
    syncFlags();
  }, [syncFlags]);

  const undo = useCallback((current: PositionSnapshot): PositionSnapshot | null => {
    if (pastRef.current.length === 0) return null;
    const prev = pastRef.current.pop()!;
    futureRef.current = [current, ...futureRef.current].slice(0, HISTORY_LIMIT);
    syncFlags();
    return prev;
  }, [syncFlags]);

  const redo = useCallback((current: PositionSnapshot): PositionSnapshot | null => {
    if (futureRef.current.length === 0) return null;
    const next = futureRef.current.shift()!;
    pastRef.current = [...pastRef.current, current].slice(-HISTORY_LIMIT);
    syncFlags();
    return next;
  }, [syncFlags]);

  return { push, clear, undo, redo, canUndo, canRedo };
}
