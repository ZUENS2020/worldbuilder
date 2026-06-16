/**
 * useTextHistory — undo/redo for a controlled text value.
 *
 * A controlled <textarea> loses the browser's native undo stack whenever its
 * value is replaced via setState (e.g. streaming AI tokens). This hook keeps
 * an explicit past/future history so ⌘/Ctrl+Z and ⌘/Ctrl+Shift+Z work.
 *
 * Usage:
 *   const h = useTextHistory(initial);
 *   <textarea value={h.value} onChange={e => h.set(e.target.value)} onKeyDown={h.onKeyDown} />
 *
 * Streaming: call set(token, { record: false }) per chunk so individual tokens
 * don't flood history, then commit() once when the stream finishes — that
 * leaves a single undo step covering the whole generation.
 */

import { useCallback, useRef, useState } from 'react';

const COALESCE_MS = 500;

interface SetOpts {
  /** Whether this change should be pushed to undo history. Default true. */
  record?: boolean;
}

export interface TextHistory {
  value: string;
  set: (next: string, opts?: SetOpts) => void;
  reset: (next: string) => void;
  commit: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function useTextHistory(initial = ''): TextHistory {
  const [value, setValue] = useState(initial);
  const [past, setPast] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);

  // Latest committed value + timestamp of last history push, for coalescing.
  const valueRef = useRef(initial);
  const lastPushRef = useRef(0);
  // The value as it was at the start of the current coalescing window.
  const baselineRef = useRef(initial);

  const set = useCallback((next: string, opts?: SetOpts) => {
    const record = opts?.record !== false;
    setValue(next);
    valueRef.current = next;
    setFuture([]);

    if (!record) return;

    const now = Date.now();
    if (now - lastPushRef.current > COALESCE_MS) {
      // Open a new coalescing window: push the value as it was before this edit.
      const prev = baselineRef.current;
      setPast((p) => (prev === next ? p : [...p, prev]));
      lastPushRef.current = now;
    }
    // Within a window, baseline stays put; only the live value advances.
    baselineRef.current = next;
  }, []);

  /** Replace value and clear all history (e.g. loading a different document). */
  const reset = useCallback((next: string) => {
    setValue(next);
    valueRef.current = next;
    baselineRef.current = next;
    setPast([]);
    setFuture([]);
    lastPushRef.current = 0;
  }, []);

  /**
   * Force the current value to become a discrete history step. Used after a
   * stream (set with record:false) to push one undo step covering the whole
   * generation: baseline is the pre-stream value, current is the result.
   */
  const commit = useCallback(() => {
    const cur = valueRef.current;
    const base = baselineRef.current;
    if (base !== cur) {
      setPast((p) => [...p, base]);
      setFuture([]);
    }
    baselineRef.current = cur;
    lastPushRef.current = 0; // next edit opens a fresh window
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [valueRef.current, ...f]);
      setValue(prev);
      valueRef.current = prev;
      baselineRef.current = prev;
      lastPushRef.current = 0;
      return p.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setPast((p) => [...p, valueRef.current]);
      setValue(next);
      valueRef.current = next;
      baselineRef.current = next;
      lastPushRef.current = 0;
      return f.slice(1);
    });
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      redo();
    }
  }, [undo, redo]);

  return {
    value,
    set,
    reset,
    commit,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    onKeyDown,
  };
}
