import { useCallback, useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type OnConnect,
  type NodeMouseHandler,
  type OnNodeDrag,
  type SelectionDragHandler,
  BackgroundVariant,
  Panel,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import EntityNode from './EntityNode';
import RelationEdge from './RelationEdge';
import RelationPicker from './RelationPicker';
import { SelectionToolPanel, LassoCaptureLayer, RectCaptureLayer, type SelectionTool } from './SelectionTools';
import { DND_MIME } from '../Palette/Palette';
import { useAppStore } from '../../stores/appStore';
import { ENTITY_CONFIG, getRelationConfig } from '../../types';
import type { Entity, Relation, EntityType } from '../../types';
import { calculateLayout, placeAroundPivot } from '../../utils/layout';
import { mergeSelection } from '../../utils/selection';
import { captureNodePositions, useCanvasHistory } from '../../hooks/useCanvasHistory';
import { computeVisibleEntityIds } from '../../utils/visibility';

const nodeTypes = { entity: EntityNode };
const edgeTypes = { relation: RelationEdge };

// Link type categories for the OSINT-style filter bar
const CHAR_LINK_TYPES = ['ally', 'enemy', 'rival', 'lover', 'family', 'mentor', 'subordinate'];
const ASSOC_LINK_TYPES = ['member_of', 'participated', 'caused', 'followed_by', 'holds', 'owns'];

function buildGraphData(
  entities: Entity[],
  relations: Relation[],
  existingPositions?: Map<string, { x: number; y: number }>,
  relationFilter?: string,
  customRelationTypes?: import('../../types').CustomRelationType[],
  visibleSet?: Set<string> | null,
) {
  // Exploration mode: restrict the canvas to the pinned "visible subgraph".
  const baseEntities = visibleSet ? entities.filter((e) => visibleSet.has(e.id)) : entities;
  const baseIds = new Set(baseEntities.map((e) => e.id));
  const baseRelations = visibleSet
    ? relations.filter((r) => baseIds.has(r.source_id) && baseIds.has(r.target_id))
    : relations;

  const filteredRelations = relationFilter
    ? baseRelations.filter((r) => r.type === relationFilter)
    : baseRelations;

  const shownIds = relationFilter
    ? new Set(filteredRelations.flatMap((r) => [r.source_id, r.target_id]))
    : new Set(baseEntities.map((e) => e.id));

  const visibleEntities = baseEntities.filter((e) => shownIds.has(e.id));
  const allRelConfig = getRelationConfig(customRelationTypes);

  const nodes: Node[] = visibleEntities.map((entity, i) => {
    const existing = existingPositions?.get(entity.id);
    const angle = (2 * Math.PI * i) / Math.max(visibleEntities.length, 1);
    const radius = 200 + visibleEntities.length * 14;
    return {
      id: entity.id,
      type: 'entity',
      position: existing ?? { x: 420 + radius * Math.cos(angle), y: 340 + radius * Math.sin(angle) },
      data: { entity, label: entity.name },
    };
  });

  const edges: Edge[] = filteredRelations.map((relation) => {
    const config = allRelConfig[relation.type] || { color: '#888', style: 'solid', label: relation.type };
    return {
      id: relation.id,
      source: relation.source_id,
      target: relation.target_id,
      sourceHandle: 'c',
      targetHandle: 'c-t',
      type: 'relation',
      data: { relationType: relation.type },
      style: { stroke: config.color, strokeWidth: 1 + relation.weight },
    };
  });

  return { nodes, edges };
}

export default function Canvas() {
  const {
    entities, relations, addEntity, addRelation, setSelectedEntity, setSelectedEntities,
    toggleEntitySelection, selectedEntityIds,
    project, selectedEntityId,
    layoutNonce, setLayouting, layoutMode,
    focusEntityId, focusNonce, focusOnEntity,
    customRelationTypes,
    explorationMode, setExplorationMode, visibleEntityIds, revealSignal,
    showAllEntities, undoExploration, resetExploration, explorationHistory,
    setInspectorTab, activeTransformHighlight, clearTransformHighlight,
    tags,
  } = useAppStore();
  const rf = useReactFlow();

  const [selectionTool, setSelectionTool] = useState<SelectionTool>('pointer');
  const canvasHistory = useCanvasHistory();
  const preDragSnapshot = useRef<ReturnType<typeof captureNodePositions> | null>(null);
  const isDraggingNodes = useRef(false);

  // ── "View as / 以…视角" observer mode (P2 fog of war) ──
  // null = 全知/作者视角(canonical truth). Otherwise filter canonical graph by
  // what `observerId` can see per the visibility model.
  const [observerId, setObserverId] = useState<string | null>(null);
  const observerVisibleSet = useMemo(
    () => (observerId ? computeVisibleEntityIds(observerId, entities, relations, tags) : null),
    [observerId, entities, relations, tags],
  );

  // The "visible subgraph" filter combines exploration pinning and observer fog.
  // null in overview mode + 全知 (show everything); otherwise the intersection.
  const explorationSet = explorationMode ? visibleEntityIds : null;
  const visibleSet = useMemo(() => {
    if (!explorationSet && !observerVisibleSet) return null;
    if (!observerVisibleSet) return explorationSet;
    if (!explorationSet) return observerVisibleSet;
    return new Set([...explorationSet].filter((id) => observerVisibleSet.has(id)));
  }, [explorationSet, observerVisibleSet]);

  const [relationFilter, setRelationFilter] = useState<string | undefined>(undefined);
  const [relPicker, setRelPicker] = useState<{ source: string; target: string; x: number; y: number } | null>(null);
  // Empty-state "choose a start node" search box.
  const [seedSearch, setSeedSearch] = useState('');
  const lastMouseRef = useRef({ x: 0, y: 0 });

  // ── Persistent position storage (localStorage per project) ──
  const POS_KEY = project ? `wb.positions.${project.id}` : '';
  const loadPositions = (): Map<string, { x: number; y: number }> => {
    if (!POS_KEY) return new Map();
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) return new Map(Object.entries(JSON.parse(raw)));
    } catch { /* corrupt data, ignore */ }
    return new Map();
  };
  const savePositions = (positions: Map<string, { x: number; y: number }>) => {
    if (!POS_KEY) return;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(Object.fromEntries(positions)));
    } catch { /* quota exceeded, ignore */ }
  };
  const nodePositions = useRef<Map<string, { x: number; y: number }>>(loadPositions());

  // Track mouse position for placing the relation picker
  useEffect(() => {
    const onMove = (e: MouseEvent) => { lastMouseRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildGraphData(entities, relations, nodePositions.current, relationFilter, customRelationTypes, visibleSet),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const applyPositionSnapshot = useCallback((snap: ReturnType<typeof captureNodePositions>) => {
    nodePositions.current = new Map(Object.entries(snap));
    setNodes((cur) =>
      cur.map((n) => ({
        ...n,
        position: snap[n.id] ?? n.position,
      })),
    );
    savePositions(nodePositions.current);
  }, [setNodes]);

  const getCurrentSnapshot = useCallback(
    () => captureNodePositions(rf.getNodes()),
    [rf],
  );

  const beginDragHistory = useCallback(() => {
    if (isDraggingNodes.current) return;
    preDragSnapshot.current = getCurrentSnapshot();
    isDraggingNodes.current = true;
  }, [getCurrentSnapshot]);

  const endDragHistory = useCallback(() => {
    if (!isDraggingNodes.current) return;
    if (preDragSnapshot.current) canvasHistory.push(preDragSnapshot.current);
    preDragSnapshot.current = null;
    isDraggingNodes.current = false;
  }, [canvasHistory]);

  const handleCanvasUndo = useCallback(() => {
    const current = getCurrentSnapshot();
    const prev = canvasHistory.undo(current);
    if (prev) applyPositionSnapshot(prev);
  }, [canvasHistory, getCurrentSnapshot, applyPositionSnapshot]);

  const handleCanvasRedo = useCallback(() => {
    const current = getCurrentSnapshot();
    const next = canvasHistory.redo(current);
    if (next) applyPositionSnapshot(next);
  }, [canvasHistory, getCurrentSnapshot, applyPositionSnapshot]);

  useEffect(() => {
    canvasHistory.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  const onNodeDragStart: OnNodeDrag = useCallback(() => {
    beginDragHistory();
  }, [beginDragHistory]);

  const onNodeDragStop: OnNodeDrag = useCallback(() => {
    endDragHistory();
  }, [endDragHistory]);

  const onSelectionDragStart: SelectionDragHandler = useCallback(() => {
    beginDragHistory();
  }, [beginDragHistory]);

  const onSelectionDragStop: SelectionDragHandler = useCallback(() => {
    endDragHistory();
  }, [endDragHistory]);

  // Sync when entities/relations/filter/visibility change — also persist positions
  const prevEntitiesRef = useRef(entities);
  const prevRelationsRef = useRef(relations);
  const prevFilterRef = useRef(relationFilter);
  const prevVisibleRef = useRef(visibleSet);
  if (
    entities !== prevEntitiesRef.current ||
    relations !== prevRelationsRef.current ||
    relationFilter !== prevFilterRef.current ||
    visibleSet !== prevVisibleRef.current
  ) {
    prevEntitiesRef.current = entities;
    prevRelationsRef.current = relations;
    prevFilterRef.current = relationFilter;
    prevVisibleRef.current = visibleSet;

    setNodes((current) => {
      current.forEach((n) => nodePositions.current.set(n.id, n.position));
      const { nodes: newNodes } = buildGraphData(entities, relations, nodePositions.current, relationFilter, customRelationTypes, visibleSet);
      return newNodes;
    });
    const { edges: newEdges } = buildGraphData(entities, relations, nodePositions.current, relationFilter, customRelationTypes, visibleSet);
    setEdges(newEdges);
    savePositions(nodePositions.current);
  }

  // Persist positions whenever nodes move (drag, layout, etc.)
  const persistOnNodesChange: typeof onNodesChange = useCallback((changes) => {
    onNodesChange(changes);
    // After ReactFlow processes the change, save positions for drag-end events
    const hasPositionChange = changes.some((c) => c.type === 'position' && c.position);
    if (hasPositionChange) {
      // Defer to next frame so ReactFlow has updated the node
      requestAnimationFrame(() => {
        setNodes((current) => {
          current.forEach((n) => nodePositions.current.set(n.id, n.position));
          savePositions(nodePositions.current);
          return current;
        });
      });
    }
  }, [onNodesChange]);

  // Initial layout: use cached positions if available, otherwise compute radial
  const initialLayoutDone = useRef(false);
  useEffect(() => {
    if (initialLayoutDone.current || entities.length === 0) return;
    initialLayoutDone.current = true;

    // Check if we have saved positions for most entities
    const cached = nodePositions.current;
    const coverage = entities.filter((e) => cached.has(e.id)).length / entities.length;

    if (coverage > 0.5) {
      // Enough cached positions — use them directly, no need to re-layout
      setNodes((current) => {
        const updated = current.map((n) => {
          const pos = cached.get(n.id);
          return pos ? { ...n, position: pos } : n;
        });
        return updated;
      });
      window.requestAnimationFrame(() => rf.fitView({ padding: 0.15, duration: 300 }));
    } else {
      // No saved positions — compute radial layout
      (async () => {
        try {
          const laidOut = await calculateLayout(nodes, edges, layoutMode, selectedEntityId ?? undefined);
          setNodes(laidOut);
          laidOut.forEach((n) => nodePositions.current.set(n.id, n.position));
          savePositions(nodePositions.current);
          window.requestAnimationFrame(() => rf.fitView({ padding: 0.15, duration: 400 }));
        } catch (e) {
          console.error('Initial layout failed:', e);
        }
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities.length]);

  // "Apply layout" / "Tidy up" button — recompute radial from scratch
  const handledNonce = useRef(layoutNonce);
  useEffect(() => {
    if (layoutNonce === handledNonce.current) return;
    handledNonce.current = layoutNonce;

    // Record pre-layout positions so「整理」can be undone.
    canvasHistory.push(getCurrentSnapshot());

    // Clear cached positions and recompute from scratch
    nodePositions.current = new Map();
    if (POS_KEY) localStorage.removeItem(POS_KEY);

    const fresh = buildGraphData(entities, relations, undefined, relationFilter, customRelationTypes, visibleSet);
    const freshNodes = fresh.nodes;
    const freshEdges = fresh.edges;

    (async () => {
      setLayouting(true);
      try {
        const laidOut = await calculateLayout(freshNodes, freshEdges, layoutMode, selectedEntityId ?? undefined);
        setNodes(laidOut);
        laidOut.forEach((n) => nodePositions.current.set(n.id, n.position));
        savePositions(nodePositions.current);
        window.requestAnimationFrame(() => rf.fitView({ padding: 0.15, duration: 500 }));
      } catch (e) {
        console.error('Layout failed:', e);
      }
      setLayouting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutNonce]);

  // Focus on a specific entity node (from Inspector relation click)
  const handledFocus = useRef(focusNonce);
  useEffect(() => {
    if (focusNonce === handledFocus.current) return;
    handledFocus.current = focusNonce;

    if (focusEntityId) {
      // Find the node and fit view to it with smooth animation
      window.requestAnimationFrame(() => {
        rf.fitView({
          nodes: [{ id: focusEntityId }],
          padding: 0.4,
          duration: 400,
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  // Keep ReactFlow node selection in sync with the store (supports multi-select).
  const syncingSelection = useRef(false);
  useEffect(() => {
    syncingSelection.current = true;
    const idSet = new Set(selectedEntityIds);
    setNodes((cur) => {
      let changed = false;
      const next = cur.map((n) => {
        const sel = idSet.has(n.id);
        if (!!n.selected !== sel) { changed = true; return { ...n, selected: sel }; }
        return n;
      });
      return changed ? next : cur;
    });
    queueMicrotask(() => { syncingSelection.current = false; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntityIds]);

  const handleBoxSelectComplete = useCallback(
    (ids: string[], additive: boolean) => {
      const merged = mergeSelection(selectedEntityIds, ids, additive);
      setSelectedEntities(merged);
      setSelectionTool('pointer');
      syncingSelection.current = true;
      setNodes((cur) => cur.map((n) => ({
        ...n,
        selected: merged.includes(n.id),
      })));
      queueMicrotask(() => { syncingSelection.current = false; });
    },
    [selectedEntityIds, setSelectedEntities, setNodes],
  );

  // ⌘Z / Ctrl+Z — exploration step back, or canvas position undo; ⌘⇧Z redo positions.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

      if (e.key === 'Escape' && selectionTool !== 'pointer') {
        setSelectionTool('pointer');
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      if (explorationMode && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoExploration();
        return;
      }

      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleCanvasUndo();
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        handleCanvasRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [explorationMode, undoExploration, selectionTool, handleCanvasUndo, handleCanvasRedo]);

  // ── Incremental reveal: position new nodes around the pivot, then fit camera. ──
  const handledReveal = useRef(revealSignal?.nonce ?? 0);
  const revealClearTimer = useRef<number | null>(null);
  useLayoutEffect(() => {
    const sig = revealSignal;
    if (!sig || sig.nonce === handledReveal.current) return;
    handledReveal.current = sig.nonce;

    if (sig.newEntityIds.length > 0) {
      const newIdSet = new Set(sig.newEntityIds);
      const pivotPos =
        nodePositions.current.get(sig.pivotId) ||
        nodes.find((n) => n.id === sig.pivotId)?.position ||
        { x: 800, y: 600 };
      const occupied = nodes
        .filter((n) => !newIdSet.has(n.id))
        .map((n) => nodePositions.current.get(n.id) ?? n.position);
      const placed = placeAroundPivot(pivotPos, sig.newEntityIds, occupied);
      placed.forEach((pos, id) => nodePositions.current.set(id, pos));
      savePositions(nodePositions.current);
      setNodes((cur) =>
        cur.map((n) => ({
          ...n,
          position: nodePositions.current.get(n.id) ?? n.position,
        })),
      );
    }

    if (sig.fit !== false) {
      window.requestAnimationFrame(() => {
        rf.fitView({
          nodes: sig.resultEntityIds.map((id) => ({ id })),
          padding: 0.3,
          duration: 450,
          maxZoom: 1.4,
        });
      });
    }

    // Single transforms: auto-clear highlight after a short pulse.
    // Batch "run all" sets persistHighlight — stays until user clicks canvas.
    if (revealClearTimer.current) window.clearTimeout(revealClearTimer.current);
    if (!sig.persistHighlight) {
      revealClearTimer.current = window.setTimeout(() => {
        clearTransformHighlight();
      }, 2600);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealSignal?.nonce]);

  // Apply (and keep) transform highlight on nodes/edges.
  useEffect(() => {
    if (!activeTransformHighlight) {
      setNodes((cur) => cur.map((n) => ({ ...n, data: { ...n.data, hl: undefined } })));
      setEdges((cur) => cur.map((e) => ({ ...e, data: { ...e.data, hl: undefined } })));
      return;
    }
    const entitySet = new Set(activeTransformHighlight.entityIds);
    const relSet = new Set(activeTransformHighlight.relationIds);
    setNodes((cur) =>
      cur.map((n) => ({
        ...n,
        data: { ...n.data, hl: entitySet.has(n.id) ? 'on' : 'dim' },
      })),
    );
    // Only edges returned by the Transform(s) stay vivid; everything else fades.
    setEdges((cur) =>
      cur.map((e) => ({
        ...e,
        data: { ...e.data, hl: relSet.has(e.id) ? 'on' : 'dim' },
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTransformHighlight, entities, relations, visibleEntityIds]);

  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      if (!project || !params.source || !params.target) return;
      const pos = lastMouseRef.current;
      setRelPicker({ source: params.source, target: params.target, x: pos.x, y: pos.y });
    },
    [project],
  );

  const handleRelPick = useCallback(
    async (type: string) => {
      if (!relPicker || !project) return;
      await addRelation({ source_id: relPicker.source, target_id: relPicker.target, type, weight: 0.5 });
      setRelPicker(null);
    },
    [relPicker, project, addRelation],
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (e, node) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) toggleEntitySelection(node.id);
      else setSelectedEntities([node.id]);
    },
    [toggleEntitySelection, setSelectedEntities],
  );

  const onNodeDoubleClick: NodeMouseHandler = useCallback((_e, node) => focusOnEntity(node.id), [focusOnEntity]);

  const onNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault();
      if (!selectedEntityIds.includes(node.id)) setSelectedEntities([node.id]);
      setInspectorTab('transform');
    },
    [selectedEntityIds, setSelectedEntities, setInspectorTab],
  );

  const onPaneClick = useCallback(() => {
    if (selectionTool !== 'pointer') return;
    setSelectedEntity(null);
    clearTransformHighlight();
    setRelPicker(null);
  }, [selectionTool, setSelectedEntity, clearTransformHighlight]);

  // Drag-drop from the Entity Palette
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData(DND_MIME) as EntityType;
      if (!type || !project) return;
      const name = prompt(`新建「${ENTITY_CONFIG[type]?.label || type}」名称:`);
      if (!name || !name.trim()) return;
      const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const created = await addEntity({ name: name.trim(), type });
      nodePositions.current.set(created.id, pos);
      setSelectedEntities([created.id]);
    },
    [project, rf, addEntity, setSelectedEntities]
  );

  const allRelConfig = getRelationConfig(customRelationTypes);

  const relationTypes = useMemo(() => {
    const types = new Set<string>();
    relations.forEach((r) => types.add(r.type));
    return Array.from(types).sort();
  }, [relations]);

  // Node degree (connection count) — drives the exploration start picker.
  const degreeMap = useMemo(() => {
    const degree = new Map<string, number>();
    relations.forEach((r) => {
      degree.set(r.source_id, (degree.get(r.source_id) ?? 0) + 1);
      degree.set(r.target_id, (degree.get(r.target_id) ?? 0) + 1);
    });
    return degree;
  }, [relations]);

  // All entities ranked by connectivity (most-connected first) for the picker.
  const rankedEntities = useMemo(
    () => [...entities].sort((a, b) => (degreeMap.get(b.id) ?? 0) - (degreeMap.get(a.id) ?? 0)),
    [entities, degreeMap],
  );

  // Filtered list shown in the empty-state start picker.
  const seedMatches = useMemo(() => {
    const q = seedSearch.trim().toLowerCase();
    const list = q
      ? rankedEntities.filter((e) => e.name.toLowerCase().includes(q))
      : rankedEntities;
    return list.slice(0, 40);
  }, [rankedEntities, seedSearch]);

  return (
    <div
      className={`wb-canvas-wrap${selectionTool === 'rect' ? ' wb-tool-rect' : selectionTool === 'lasso' ? ' wb-tool-lasso' : ''}`}
      style={{ width: '100%', height: '100%', background: 'var(--mt-canvas)', position: 'relative' }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={persistOnNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onSelectionDragStart={onSelectionDragStart}
        onSelectionDragStop={onSelectionDragStop}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'relation' }}
        connectionLineStyle={{ stroke: 'var(--mt-accent)', strokeWidth: 2 }}
        selectionOnDrag={false}
        panOnDrag
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        selectNodesOnDrag={false}
      >
        <Background variant={BackgroundVariant.Dots} color="var(--mt-grid)" gap={22} size={1.4} />
        <Controls showInteractive={false} />

        {/* Selection tools: pointer / rectangle / lasso */}
        <Panel position="top-left">
          <SelectionToolPanel
            tool={selectionTool}
            onChange={setSelectionTool}
            selectedCount={selectedEntityIds.length}
            canUndo={canvasHistory.canUndo}
            canRedo={canvasHistory.canRedo}
            onUndo={handleCanvasUndo}
            onRedo={handleCanvasRedo}
          />
        </Panel>

        {/* Box-select capture layers — preview only while dragging */}
        {selectionTool === 'rect' && (
          <RectCaptureLayer nodes={nodes} onComplete={handleBoxSelectComplete} />
        )}
        {selectionTool === 'lasso' && (
          <LassoCaptureLayer nodes={nodes} onComplete={handleBoxSelectComplete} />
        )}

        {/* "View as / 以…视角" observer selector — P2 fog of war */}
        {/* Single top-right stack: "View as" observer selector + exploration controls.
            Both must live in ONE Panel, otherwise React Flow anchors each to the
            same corner and they overlap. */}
        <Panel position="top-right">
          <div
            style={{
              background: 'var(--mt-panel)', border: '1px solid var(--mt-border)',
              borderRadius: 4, padding: '5px 7px', display: 'flex', gap: 6,
              alignItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              marginBottom: 6,
            }}
          >
            <span style={{ fontSize: 11, color: observerId ? 'var(--mt-accent-dark)' : 'var(--mt-text-muted)', fontWeight: 600 }}>
              {observerId ? '👁 视角' : '👁 全知'}
            </span>
            <select
              value={observerId ?? ''}
              onChange={(e) => setObserverId(e.target.value || null)}
              style={{
                fontSize: 11, padding: '2px 4px', maxWidth: 150,
                border: `1px solid ${observerId ? 'var(--mt-accent)' : 'var(--mt-border)'}`,
                borderRadius: 3, background: '#fff', color: 'var(--mt-text)',
              }}
              title="以某角色视角查看：看不到的实体会消失（战争迷雾）"
            >
              <option value="">全知（作者视角）</option>
              {entities
                .filter((e) => e.type === 'character')
                .map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
            </select>
            {observerId && observerVisibleSet && (
              <span style={{ fontSize: 10, color: 'var(--mt-text-muted)' }}>
                可见 {observerVisibleSet.size}/{entities.length}
              </span>
            )}
          </div>

          {/* Exploration mode controls (Maltego-style incremental investigation) */}
          <div
            style={{
              background: 'var(--mt-panel)', border: '1px solid var(--mt-border)',
              borderRadius: 4, padding: '5px 7px', display: 'flex', gap: 6,
              alignItems: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
            }}
          >
            {!explorationMode ? (
              <button
                className="mt-btn"
                style={{ fontSize: 11, padding: '3px 9px', fontWeight: 600, border: '1px solid var(--mt-border)' }}
                onClick={() => setExplorationMode(true)}
                title="进入探索模式：从选中的节点出发，右键 Transform 逐步展开关联"
              >
                🔭 探索模式
              </button>
            ) : (
              <>
                {/* Status only — exiting is handled by the dedicated button below. */}
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mt-accent-dark)', padding: '0 2px' }}>
                  🔭 探索中
                </span>
                <span style={{ fontSize: 10, color: 'var(--mt-text-muted)' }}>
                  {visibleEntityIds.size} 个节点
                </span>
                <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--mt-border-soft)', margin: '0 2px' }} />
                <button
                  className="mt-btn"
                  style={{ fontSize: 10, padding: '3px 8px', border: '1px solid var(--mt-border)' }}
                  onClick={() => undoExploration()}
                  disabled={explorationHistory.length === 0}
                  title="退回上一步展开"
                >
                  ↩ 退回上一步
                </button>
                <button
                  className="mt-btn"
                  style={{ fontSize: 10, padding: '3px 8px', border: '1px solid var(--mt-border)' }}
                  onClick={() => resetExploration()}
                  title="恢复到刚进入探索时的起点状态"
                >
                  ⟲ 恢复初始状态
                </button>
                <button
                  className="mt-btn"
                  style={{ fontSize: 10, padding: '3px 8px', border: '1px solid var(--mt-border)' }}
                  onClick={() => showAllEntities()}
                  title="把项目里所有实体都加入画布"
                >
                  显示全部
                </button>
                <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--mt-border-soft)', margin: '0 2px' }} />
                <button
                  className="mt-btn"
                  style={{ fontSize: 10, padding: '3px 8px', border: '1px solid var(--mt-border)', color: '#c0392b' }}
                  onClick={() => setExplorationMode(false)}
                  title="退出探索模式，回到全览"
                >
                  ✕ 退出探索
                </button>
              </>
            )}
          </div>
        </Panel>
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => {
            const entity = node.data?.entity as Entity | undefined;
            return entity ? (ENTITY_CONFIG[entity.type]?.color || '#888') : '#888';
          }}
          style={{ background: '#fff' }}
          maskColor="rgba(220,232,245,0.55)"
        />

        {/* Relation filter (bottom-left dock) — OSINT link-type categories */}
        {relationTypes.length > 0 && (
          <Panel position="bottom-left">
            <div
              style={{
                background: 'var(--mt-panel)',
                border: '1px solid var(--mt-border)',
                borderRadius: 4,
                padding: '6px 8px',
                display: 'flex',
                gap: 4,
                alignItems: 'center',
                flexWrap: 'wrap',
                maxWidth: 520,
                boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              }}
            >
              <span style={{ color: 'var(--mt-text-muted)', fontSize: 10, marginRight: 2 }}>链路类型</span>
              <button
                className={`mt-btn${!relationFilter ? ' active' : ''}`}
                style={{ fontSize: 10, padding: '2px 7px', border: '1px solid var(--mt-border)' }}
                onClick={() => setRelationFilter(undefined)}
              >
                全部
              </button>
              {/* Group 1: Character links (rival/ally/mentor/family/enemy) */}
              {CHAR_LINK_TYPES.filter(t => relationTypes.includes(t)).length > 0 && (
                <span style={{ color: 'var(--mt-text-faint)', fontSize: 9, margin: '0 2px' }}>│ 人物</span>
              )}
              {CHAR_LINK_TYPES.filter(t => relationTypes.includes(t)).map((rt) => {
                const config = allRelConfig[rt] || { color: '#888', label: rt };
                const on = relationFilter === rt;
                return (
                  <button
                    key={rt}
                    onClick={() => setRelationFilter(on ? undefined : rt)}
                    className="mt-btn"
                    style={{
                      fontSize: 10, padding: '2px 7px',
                      border: `1px solid ${on ? config.color : 'var(--mt-border)'}`,
                      background: on ? `${config.color}22` : 'transparent',
                      color: on ? config.color : 'var(--mt-text)',
                      fontWeight: on ? 600 : 400,
                    }}
                  >
                    {config.label}
                  </button>
                );
              })}
              {/* Group 2: Association links */}
              {ASSOC_LINK_TYPES.filter(t => relationTypes.includes(t)).length > 0 && (
                <span style={{ color: 'var(--mt-text-faint)', fontSize: 9, margin: '0 2px' }}>│ 关联</span>
              )}
              {ASSOC_LINK_TYPES.filter(t => relationTypes.includes(t)).map((rt) => {
                const config = allRelConfig[rt] || { color: '#888', label: rt };
                const on = relationFilter === rt;
                return (
                  <button
                    key={rt}
                    onClick={() => setRelationFilter(on ? undefined : rt)}
                    className="mt-btn"
                    style={{
                      fontSize: 10, padding: '2px 7px',
                      border: `1px solid ${on ? config.color : 'var(--mt-border)'}`,
                      background: on ? `${config.color}22` : 'transparent',
                      color: on ? config.color : 'var(--mt-text)',
                    }}
                  >
                    {config.label}
                  </button>
                );
              })}
              {/* Group 3: Infrastructure links (located_at) — toggle */}
              {relationTypes.includes('located_at') && (
                <>
                  <span style={{ color: 'var(--mt-text-faint)', fontSize: 9, margin: '0 2px' }}>│ 基础</span>
                  <button
                    onClick={() => setRelationFilter(relationFilter === 'located_at' ? undefined : 'located_at')}
                    className="mt-btn"
                    style={{
                      fontSize: 10, padding: '2px 7px',
                      border: `1px solid ${relationFilter === 'located_at' ? '#999' : 'var(--mt-border)'}`,
                      background: relationFilter === 'located_at' ? '#9992' : 'transparent',
                      color: relationFilter === 'located_at' ? '#666' : 'var(--mt-text-muted)',
                    }}
                  >
                    📍 位置
                  </button>
                </>
              )}
              {/* Group 4: Custom relation types */}
              {customRelationTypes.filter(ct => relationTypes.includes(ct.id)).length > 0 && (
                <>
                  <span style={{ color: 'var(--mt-text-faint)', fontSize: 9, margin: '0 2px' }}>│ 自定义</span>
                  {customRelationTypes.filter(ct => relationTypes.includes(ct.id)).map((ct) => {
                    const on = relationFilter === ct.id;
                    return (
                      <button
                        key={ct.id}
                        onClick={() => setRelationFilter(on ? undefined : ct.id)}
                        className="mt-btn"
                        style={{
                          fontSize: 10, padding: '2px 7px',
                          border: `1px solid ${on ? ct.color : 'var(--mt-border)'}`,
                          background: on ? `${ct.color}22` : 'transparent',
                          color: on ? ct.color : 'var(--mt-text)',
                        }}
                      >
                        {ct.name}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </Panel>
        )}
      </ReactFlow>

      {/* Exploration empty-state: let the user choose any start node. */}
      {explorationMode && visibleEntityIds.size === 0 && (
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', pointerEvents: 'none', zIndex: 5,
          }}
        >
          <div
            style={{
              pointerEvents: 'auto', background: 'var(--mt-panel)',
              border: '1px solid var(--mt-border)', borderRadius: 8,
              boxShadow: '0 6px 24px rgba(0,0,0,0.12)', padding: '18px 20px',
              width: 'min(420px, 92vw)', display: 'flex', flexDirection: 'column',
              maxHeight: '70%',
            }}
          >
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 32, marginBottom: 6 }}>🔭</div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: 'var(--mt-accent-dark)' }}>
                选择一个调查起点
              </div>
              <div style={{ fontSize: 12, color: 'var(--mt-text-muted)', lineHeight: 1.5 }}>
                选中起点后右键节点运行 Transform 逐步展开关联。
              </div>
            </div>

            {entities.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--mt-text-muted)', textAlign: 'center', padding: '12px 0' }}>
                当前项目还没有实体，先从左侧调色盘拖一个到画布。
              </div>
            ) : (
              <>
                <input
                  autoFocus
                  value={seedSearch}
                  onChange={(e) => setSeedSearch(e.target.value)}
                  placeholder="搜索实体名称…"
                  style={{
                    background: '#fff', border: '1px solid var(--mt-border)', borderRadius: 4,
                    padding: '7px 10px', fontSize: 13, outline: 'none', marginBottom: 8,
                    color: 'var(--mt-text)',
                  }}
                />
                <div style={{ overflowY: 'auto', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {seedMatches.map((e) => {
                    const cfg = ENTITY_CONFIG[e.type] || ENTITY_CONFIG.character;
                    const deg = degreeMap.get(e.id) ?? 0;
                    return (
                      <button
                        key={e.id}
                        onClick={() => { focusOnEntity(e.id); setSeedSearch(''); }}
                        title="作为起点放上画布"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left',
                          padding: '6px 9px', borderRadius: 4, border: '1px solid transparent',
                          background: 'transparent', cursor: 'pointer', fontSize: 12, color: 'var(--mt-text)',
                          width: '100%',
                        }}
                        onMouseEnter={(ev) => { (ev.currentTarget as HTMLButtonElement).style.background = 'var(--mt-btn-hover)'; }}
                        onMouseLeave={(ev) => { (ev.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                      >
                        <span style={{
                          width: 22, height: 22, borderRadius: 5, background: '#fff', flex: '0 0 22px',
                          border: `1px solid ${cfg.color}`, display: 'flex', alignItems: 'center',
                          justifyContent: 'center', fontSize: 12,
                        }}>{cfg.icon}</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{e.name}</span>
                        <span style={{ fontSize: 10, color: cfg.color }}>{cfg.label}</span>
                        <span style={{ fontSize: 10, color: 'var(--mt-text-faint)' }}>🔗 {deg}</span>
                      </button>
                    );
                  })}
                  {seedMatches.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--mt-text-muted)', textAlign: 'center', padding: '10px 0' }}>
                      没有匹配「{seedSearch}」的实体
                    </div>
                  )}
                </div>
                <div style={{ borderTop: '1px solid var(--mt-border-soft)', marginTop: 8, paddingTop: 8, textAlign: 'center' }}>
                  <button
                    className="mt-btn"
                    style={{ fontSize: 11, padding: '4px 12px', border: '1px solid var(--mt-border)' }}
                    onClick={() => showAllEntities()}
                  >
                    或：显示全部实体
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {relPicker && (
        <RelationPicker
          sourceName={entities.find((e) => e.id === relPicker.source)?.name || '…'}
          targetName={entities.find((e) => e.id === relPicker.target)?.name || '…'}
          position={{ x: relPicker.x, y: relPicker.y }}
          onSelect={handleRelPick}
          onCancel={() => setRelPicker(null)}
        />
      )}
    </div>
  );
}
