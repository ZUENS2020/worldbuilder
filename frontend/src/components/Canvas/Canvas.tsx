import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
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
  BackgroundVariant,
  Panel,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import EntityNode from './EntityNode';
import RelationEdge from './RelationEdge';
import RelationPicker from './RelationPicker';
import ContextMenu from '../ContextMenu/ContextMenu';
import { DND_MIME } from '../Palette/Palette';
import { useAppStore } from '../../stores/appStore';
import { ENTITY_CONFIG, RELATION_CONFIG } from '../../types';
import type { Entity, Relation, EntityType } from '../../types';
import { calculateLayout } from '../../utils/layout';
import { ForceSimulation } from '../../utils/forceSim';

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
) {
  const filteredRelations = relationFilter
    ? relations.filter((r) => r.type === relationFilter)
    : relations;

  const visibleEntityIds = relationFilter
    ? new Set(filteredRelations.flatMap((r) => [r.source_id, r.target_id]))
    : new Set(entities.map((e) => e.id));

  const visibleEntities = entities.filter((e) => visibleEntityIds.has(e.id));

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
    const config = RELATION_CONFIG[relation.type] || { color: '#888', style: 'solid', label: relation.type };
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
    entities, relations, addEntity, addRelation, setSelectedEntity, setContextMenu,
    project, selectedEntityId,
    layoutType, layoutNonce, setLayouting,
  } = useAppStore();
  const rf = useReactFlow();

  const [relationFilter, setRelationFilter] = useState<string | undefined>(undefined);
  const [relPicker, setRelPicker] = useState<{ source: string; target: string; x: number; y: number } | null>(null);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const nodePositions = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Track mouse position for placing the relation picker
  useEffect(() => {
    const onMove = (e: MouseEvent) => { lastMouseRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildGraphData(entities, relations, nodePositions.current, relationFilter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync when entities/relations/filter change
  const prevEntitiesRef = useRef(entities);
  const prevRelationsRef = useRef(relations);
  const prevFilterRef = useRef(relationFilter);
  if (
    entities !== prevEntitiesRef.current ||
    relations !== prevRelationsRef.current ||
    relationFilter !== prevFilterRef.current
  ) {
    prevEntitiesRef.current = entities;
    prevRelationsRef.current = relations;
    prevFilterRef.current = relationFilter;

    setNodes((current) => {
      current.forEach((n) => nodePositions.current.set(n.id, n.position));
      const { nodes: newNodes } = buildGraphData(entities, relations, nodePositions.current, relationFilter);
      return newNodes;
    });
    const { edges: newEdges } = buildGraphData(entities, relations, nodePositions.current, relationFilter);
    setEdges(newEdges);
  }

  // --- Live force simulation (Maltego "organic" graph) ---
  const simRef = useRef(new ForceSimulation());
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef<string | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const stopLoop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const step = useCallback(() => {
    const sim = simRef.current;
    const dragId = draggingRef.current;
    if (dragId) {
      const dn = nodesRef.current.find((n) => n.id === dragId);
      if (dn) sim.setFixed(dragId, dn.position.x, dn.position.y);
    }
    const active = sim.tick();
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id === draggingRef.current) return n; // ReactFlow controls the dragged node
        const p = sim.get(n.id);
        return p ? { ...n, position: { x: p.x, y: p.y } } : n;
      })
    );
    rafRef.current = active ? requestAnimationFrame(step) : null;
  }, [setNodes]);

  // Seed the simulation from the source data (entities/relations), using any
  // cached position, so it never depends on lagging ReactFlow node state.
  const startSim = useCallback((reheat = 1) => {
    const sim = simRef.current;
    const visibleIds = new Set(
      relationFilter
        ? relations.filter((r) => r.type === relationFilter).flatMap((r) => [r.source_id, r.target_id])
        : entities.map((e) => e.id),
    );
    const positions = entities
      .filter((e) => visibleIds.has(e.id))
      .map((e) => {
        const p = nodePositions.current.get(e.id);
        return { id: e.id, x: p?.x ?? NaN, y: p?.y ?? NaN, type: e.type };
      });
    const links = relations
      .filter((r) => !relationFilter || r.type === relationFilter)
      .map((r) => ({ source: r.source_id, target: r.target_id }));
    sim.setData(positions, links);
    sim.reheat(reheat);
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(step);
  }, [entities, relations, relationFilter, step]);

  // Run/re-seed the live simulation for the 'force' engine whenever the graph
  // data changes (initial load, transforms expanding new nodes, etc.).
  // Before starting force, compute radial seed positions so the simulation
  // starts from a sensible layout instead of random chaos.
  useEffect(() => {
    if (entities.length > 0 && layoutType === 'force') {
      // Compute radial seed positions first, then hand them to force sim
      (async () => {
        const { nodes: seedNodes } = buildGraphData(entities, relations, undefined, relationFilter);
        const seedEdges = buildGraphData(entities, relations, undefined, relationFilter).edges;
        try {
          const radialSeed = await calculateLayout(seedNodes, seedEdges, 'radial', selectedEntityId ?? undefined);
          // Save radial positions as seed for force sim
          radialSeed.forEach((n) => nodePositions.current.set(n.id, n.position));
        } catch (e) {
          console.error('Radial seed failed:', e);
        }
        startSim(0.9);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, relations, layoutType]);

  // Initial layout: apply radial on first load so the graph isn't random chaos
  const initialLayoutDone = useRef(false);
  useEffect(() => {
    if (initialLayoutDone.current || entities.length === 0) return;
    initialLayoutDone.current = true;
    (async () => {
      try {
        const laidOut = await calculateLayout(nodes, edges, 'radial', selectedEntityId ?? undefined);
        setNodes(laidOut);
        laidOut.forEach((n) => nodePositions.current.set(n.id, n.position));
        window.requestAnimationFrame(() => rf.fitView({ padding: 0.2, duration: 400 }));
      } catch (e) {
        console.error('Initial layout failed:', e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities.length]);

  // Clean up the animation frame on unmount
  useEffect(() => stopLoop, [stopLoop]);

  // "Apply layout" button (toolbar) + "Tidy up" button
  const handledNonce = useRef(layoutNonce);
  useEffect(() => {
    if (layoutNonce === handledNonce.current) return;
    handledNonce.current = layoutNonce;

    // Stop any running force sim
    stopLoop();

    // For tidyUp / radial: clear cached positions and recompute from scratch
    // so the layout isn't biased by old positions
    const freshNodes = buildGraphData(entities, relations, undefined, relationFilter).nodes;
    const freshEdges = buildGraphData(entities, relations, undefined, relationFilter).edges;

    if (layoutType === 'force') {
      // Force: seed from radial first, then sim
      (async () => {
        setLayouting(true);
        try {
          const radialSeed = await calculateLayout(freshNodes, freshEdges, 'radial', selectedEntityId ?? undefined);
          radialSeed.forEach((n) => nodePositions.current.set(n.id, n.position));
          setNodes(radialSeed);
        } catch (e) {
          console.error('Radial seed failed:', e);
        }
        setLayouting(false);
        startSim(1);
      })();
      return;
    }

    // Static layouts (radial / hierarchical): compute from scratch
    (async () => {
      setLayouting(true);
      try {
        const laidOut = await calculateLayout(freshNodes, freshEdges, layoutType, selectedEntityId ?? undefined);
        setNodes(laidOut);
        laidOut.forEach((n) => nodePositions.current.set(n.id, n.position));
        window.requestAnimationFrame(() => rf.fitView({ padding: 0.15, duration: 500 }));
      } catch (e) {
        console.error('Layout failed:', e);
      }
      setLayouting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutNonce]);

  // Dragging a node pins it and re-heats the simulation so neighbours react.
  const onNodeDragStart: OnNodeDrag<Node> = useCallback((_, node) => {
    if (layoutType !== 'force') return;
    draggingRef.current = node.id;
    simRef.current.setFixed(node.id, node.position.x, node.position.y);
    startSim(0.6);
  }, [layoutType, startSim]);

  const onNodeDragStop: OnNodeDrag<Node> = useCallback((_, node) => {
    nodePositions.current.set(node.id, node.position);
    if (draggingRef.current === node.id) {
      simRef.current.clearFixed(node.id);
      draggingRef.current = null;
      simRef.current.reheat(0.4);
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(step);
    }
  }, [step]);

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

  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => setSelectedEntity(node.id), [setSelectedEntity]);

  const onNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault();
      setSelectedEntity(node.id);
      setContextMenu({ x: event.clientX, y: event.clientY, entityId: node.id });
    },
    [setSelectedEntity, setContextMenu]
  );

  const onPaneClick = useCallback(() => {
    setSelectedEntity(null);
    setContextMenu(null);
    setRelPicker(null);
  }, [setSelectedEntity, setContextMenu]);

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
      setSelectedEntity(created.id);
    },
    [project, rf, addEntity, setSelectedEntity]
  );

  const relationTypes = useMemo(() => {
    const types = new Set<string>();
    relations.forEach((r) => types.add(r.type));
    return Array.from(types).sort();
  }, [relations]);

  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--mt-canvas)' }} onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'relation' }}
        connectionLineStyle={{ stroke: 'var(--mt-accent)', strokeWidth: 2 }}
      >
        <Background variant={BackgroundVariant.Dots} color="var(--mt-grid)" gap={22} size={1.4} />
        <Controls showInteractive={false} />
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
                const config = RELATION_CONFIG[rt] || { color: '#888', label: rt };
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
                const config = RELATION_CONFIG[rt] || { color: '#888', label: rt };
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
            </div>
          </Panel>
        )}
      </ReactFlow>
      <ContextMenu />
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
