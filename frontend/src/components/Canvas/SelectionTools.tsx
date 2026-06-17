import { useCallback, useRef, useState } from 'react';
import { useReactFlow, type Node, type ReactFlowInstance } from '@xyflow/react';
import type { Entity, EntityType } from '../../types';
import { ENTITY_CONFIG } from '../../types';
import { normalizeRect, pointInPolygon, pointInRect } from '../../utils/selection';

type LocalPoint = { x: number; y: number };

export type SelectionTool = 'pointer' | 'rect' | 'lasso';

type OnSelectComplete = (ids: string[], additive: boolean) => void;

function nodeCenterFlow(node: Node): { x: number; y: number } | null {
  const entity = node.data?.entity as Entity | undefined;
  if (!entity) return null;
  const cfg = ENTITY_CONFIG[entity.type as EntityType] || ENTITY_CONFIG.character;
  return { x: node.position.x + cfg.size / 2, y: node.position.y + cfg.size / 2 };
}

function localToFlow(
  rf: ReactFlowInstance,
  layer: HTMLElement,
  p: LocalPoint,
): { x: number; y: number } {
  const rect = layer.getBoundingClientRect();
  return rf.screenToFlowPosition({ x: rect.left + p.x, y: rect.top + p.y });
}

function selectByPolygon(nodes: Node[], rf: ReactFlowInstance, layer: HTMLElement, poly: LocalPoint[]): string[] {
  if (poly.length < 3) return [];
  const flowPoly = poly.map((p) => localToFlow(rf, layer, p));
  const selected: string[] = [];
  for (const node of nodes) {
    const center = nodeCenterFlow(node);
    if (center && pointInPolygon(center, flowPoly)) selected.push(node.id);
  }
  return selected;
}

function selectByRect(nodes: Node[], rf: ReactFlowInstance, layer: HTMLElement, a: LocalPoint, b: LocalPoint): string[] {
  const flowA = localToFlow(rf, layer, a);
  const flowB = localToFlow(rf, layer, b);
  const box = { x1: flowA.x, y1: flowA.y, x2: flowB.x, y2: flowB.y };
  const selected: string[] = [];
  for (const node of nodes) {
    const center = nodeCenterFlow(node);
    if (center && pointInRect(center, box)) selected.push(node.id);
  }
  return selected;
}

interface CaptureLayerProps {
  nodes: Node[];
  onComplete: OnSelectComplete;
}

/** Rectangle box-select — transient preview while dragging, nodes only after release. */
export function RectCaptureLayer({ nodes, onComplete }: CaptureLayerProps) {
  const rf = useReactFlow();
  const layerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ start: LocalPoint; end: LocalPoint } | null>(null);
  const drawing = useRef(false);
  const startRef = useRef<LocalPoint | null>(null);
  const additiveRef = useRef(false);

  const toLocal = useCallback((clientX: number, clientY: number): LocalPoint => {
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    layerRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    additiveRef.current = e.metaKey || e.ctrlKey || e.shiftKey;
    const start = toLocal(e.clientX, e.clientY);
    startRef.current = start;
    setBox({ start, end: start });
  }, [toLocal]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drawing.current || !startRef.current) return;
    setBox({ start: startRef.current, end: toLocal(e.clientX, e.clientY) });
  }, [toLocal]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!drawing.current || !startRef.current) return;
    drawing.current = false;
    try {
      layerRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* already released */ }
    const layer = layerRef.current;
    const start = startRef.current;
    const end = toLocal(e.clientX, e.clientY);
    startRef.current = null;
    setBox(null);
    if (!layer) return;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 6) return;
    onComplete(selectByRect(nodes, rf, layer, start, end), additiveRef.current);
  }, [nodes, onComplete, rf, toLocal]);

  const preview = box ? normalizeRect(box.start, box.end) : null;

  return (
    <div
      ref={layerRef}
      className="wb-select-capture"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {preview && preview.width > 0 && preview.height > 0 && (
        <svg className="wb-select-svg">
          <rect
            x={preview.x}
            y={preview.y}
            width={preview.width}
            height={preview.height}
            className="wb-rect-preview"
          />
        </svg>
      )}
    </div>
  );
}

/** Free-form lasso — transient path while dragging, nodes only after release. */
export function LassoCaptureLayer({ nodes, onComplete }: CaptureLayerProps) {
  const rf = useReactFlow();
  const layerRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<LocalPoint[]>([]);
  const drawing = useRef(false);
  const pathRef = useRef<LocalPoint[]>([]);
  const additiveRef = useRef(false);

  const toLocal = useCallback((clientX: number, clientY: number): LocalPoint => {
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    layerRef.current?.setPointerCapture(e.pointerId);
    drawing.current = true;
    additiveRef.current = e.metaKey || e.ctrlKey || e.shiftKey;
    const start = toLocal(e.clientX, e.clientY);
    pathRef.current = [start];
    setPoints([start]);
  }, [toLocal]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drawing.current) return;
    const p = toLocal(e.clientX, e.clientY);
    const last = pathRef.current[pathRef.current.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 3) return;
    pathRef.current = [...pathRef.current, p];
    setPoints(pathRef.current);
  }, [toLocal]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!drawing.current) return;
    drawing.current = false;
    try {
      layerRef.current?.releasePointerCapture(e.pointerId);
    } catch { /* already released */ }
    const layer = layerRef.current;
    const poly = [...pathRef.current, toLocal(e.clientX, e.clientY)];
    pathRef.current = [];
    setPoints([]);
    if (!layer) return;
    onComplete(selectByPolygon(nodes, rf, layer, poly), additiveRef.current);
  }, [nodes, onComplete, rf, toLocal]);

  const pathD =
    points.length > 0
      ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + (points.length > 2 ? ' Z' : '')
      : '';

  return (
    <div
      ref={layerRef}
      className="wb-select-capture"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {points.length > 1 && (
        <svg className="wb-select-svg">
          <path d={pathD} className="wb-lasso-preview" />
        </svg>
      )}
    </div>
  );
}

interface SelectionToolPanelProps {
  tool: SelectionTool;
  onChange: (tool: SelectionTool) => void;
  selectedCount: number;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

export function SelectionToolPanel({
  tool, onChange, selectedCount, canUndo, canRedo, onUndo, onRedo,
}: SelectionToolPanelProps) {
  const btn = (id: SelectionTool, icon: string, label: string, title: string) => (
    <button
      type="button"
      className={`mt-btn${tool === id ? ' active' : ''}`}
      style={{
        fontSize: 11,
        padding: '3px 8px',
        border: `1px solid ${tool === id ? 'var(--mt-accent)' : 'var(--mt-border)'}`,
        fontWeight: tool === id ? 600 : 400,
      }}
      title={title}
      onClick={() => onChange(id)}
    >
      {icon} {label}
    </button>
  );

  return (
    <div
      style={{
        background: 'var(--mt-panel)',
        border: '1px solid var(--mt-border)',
        borderRadius: 4,
        padding: '5px 7px',
        display: 'flex',
        gap: 6,
        alignItems: 'center',
        boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
      }}
    >
      {btn('pointer', '↖', '选择', '点击选中；多选后可整体拖动')}
      {btn('rect', '▭', '矩形', '拖拽矩形框选，松开后只高亮节点')}
      {btn('lasso', '✎', '套索', '拖拽闭合路径框选，松开后只高亮节点')}
      <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--mt-border-soft)', margin: '0 2px' }} />
      <button
        type="button"
        className="mt-btn"
        style={{ fontSize: 11, padding: '3px 8px', border: '1px solid var(--mt-border)' }}
        title="撤销节点位置 (⌘/Ctrl+Z)"
        disabled={!canUndo}
        onClick={onUndo}
      >
        ↶
      </button>
      <button
        type="button"
        className="mt-btn"
        style={{ fontSize: 11, padding: '3px 8px', border: '1px solid var(--mt-border)' }}
        title="重做节点位置 (⌘/Ctrl+Shift+Z)"
        disabled={!canRedo}
        onClick={onRedo}
      >
        ↷
      </button>
      {selectedCount > 1 && (
        <span style={{ fontSize: 10, color: 'var(--mt-accent-dark)', marginLeft: 2 }}>
          已选 {selectedCount}
        </span>
      )}
    </div>
  );
}
