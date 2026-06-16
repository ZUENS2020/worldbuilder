/**
 * EventGraph — M3: 独立事件画布
 *
 * Single-source-of-truth projection: reads the SAME entities/relations
 * from useAppStore. Only shows event-type entities + caused/followed_by
 * relations. Edits propagate everywhere via shared store.
 *
 * Layout: ELK hierarchical (direction RIGHT) so events flow left→right
 * by causal/temporal order.
 */

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
  BackgroundVariant,
  Panel,
  MarkerType,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import EntityNode from '../Canvas/EntityNode';
import RelationEdge from '../Canvas/RelationEdge';
import ContextMenu from '../ContextMenu/ContextMenu';
import { useAppStore } from '../../stores/appStore';
import { ENTITY_CONFIG, RELATION_CONFIG } from '../../types';
import type { Entity, Relation } from '../../types';
import { calculateLayout } from '../../utils/layout';

const nodeTypes = { entity: EntityNode };
const edgeTypes = { relation: RelationEdge };

const EVENT_REL_TYPES = new Set(['caused', 'followed_by']);

function buildEventData(
  entities: Entity[],
  relations: Relation[],
  existingPositions?: Map<string, { x: number; y: number }>,
) {
  // Project: only event entities
  const eventEntities = entities.filter((e) => e.type === 'event');
  const eventIds = new Set(eventEntities.map((e) => e.id));

  // Only relations between two events of causal type
  const eventRelations = relations.filter(
    (r) => eventIds.has(r.source_id) && eventIds.has(r.target_id) && EVENT_REL_TYPES.has(r.type),
  );

  const nodes: Node[] = eventEntities.map((entity) => {
    const existing = existingPositions?.get(entity.id);
    const time = entity.properties?.time || entity.properties?.date || '';
    return {
      id: entity.id,
      type: 'entity',
      position: existing ?? { x: 0, y: 0 },
      data: { entity, label: entity.name, time },
    };
  });

  const edges: Edge[] = eventRelations.map((relation) => {
    const config = RELATION_CONFIG[relation.type] || { color: '#888', style: 'solid', label: relation.type };
    return {
      id: relation.id,
      source: relation.source_id,
      target: relation.target_id,
      type: 'relation',
      data: { relationType: relation.type },
      style: { stroke: config.color, strokeWidth: 1.5 + relation.weight },
      markerEnd: MarkerType.ArrowClosed,
    };
  });

  return { nodes, edges };
}

export default function EventGraph() {
  const {
    entities, relations, addRelation, setSelectedEntity, setContextMenu,
    project,
  } = useAppStore();
  const rf = useReactFlow();

  const nodePositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [layoutApplied, setLayoutApplied] = useState(false);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildEventData(entities, relations, nodePositions.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync when entities/relations change
  const prevRef = useRef({ entities, relations });
  if (entities !== prevRef.current.entities || relations !== prevRef.current.relations) {
    prevRef.current = { entities, relations };
    setNodes((current) => {
      current.forEach((n) => nodePositions.current.set(n.id, n.position));
      const { nodes: newNodes } = buildEventData(entities, relations, nodePositions.current);
      return newNodes;
    });
    const { edges: newEdges } = buildEventData(entities, relations, nodePositions.current);
    setEdges(newEdges);
    setLayoutApplied(false);
  }

  // Auto-apply hierarchical layout on first load or data change
  useEffect(() => {
    if (layoutApplied || nodes.length === 0) return;
    (async () => {
      try {
        const laidOut = await calculateLayout(nodes, edges, 'hierarchical');
        setNodes(laidOut);
        laidOut.forEach((n) => nodePositions.current.set(n.id, n.position));
        window.requestAnimationFrame(() => rf.fitView({ padding: 0.2, duration: 300 }));
        setLayoutApplied(true);
      } catch (e) {
        console.error('Event layout failed:', e);
      }
    })();
  }, [layoutApplied, nodes, edges, setNodes, rf]);

  const onNodeDragStop = useCallback((_: any, node: Node) => {
    nodePositions.current.set(node.id, node.position);
  }, []);

  const onConnect: OnConnect = useCallback(
    async (params: Connection) => {
      if (!project || !params.source || !params.target) return;
      const relType = prompt('因果类型 (caused / followed_by):');
      if (!relType) return;
      await addRelation({ source_id: params.source, target_id: params.target, type: relType, weight: 0.7 });
    },
    [project, addRelation],
  );

  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => setSelectedEntity(node.id), [setSelectedEntity]);
  const onNodeContextMenu: NodeMouseHandler = useCallback(
    (event, node) => {
      event.preventDefault();
      setSelectedEntity(node.id);
      setContextMenu({ x: event.clientX, y: event.clientY, entityId: node.id });
    },
    [setSelectedEntity, setContextMenu],
  );
  const onPaneClick = useCallback(() => { setSelectedEntity(null); setContextMenu(null); }, [setSelectedEntity, setContextMenu]);

  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--mt-canvas)' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'relation', markerEnd: MarkerType.ArrowClosed }}
        connectionLineStyle={{ stroke: 'var(--mt-accent)', strokeWidth: 2 }}
      >
        <Background variant={BackgroundVariant.Dots} color="var(--mt-grid)" gap={22} size={1.4} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable zoomable
          nodeColor={() => ENTITY_CONFIG.event.color}
          style={{ background: '#fff' }}
          maskColor="rgba(220,232,245,0.55)"
        />
        <Panel position="top-left">
          <div style={{
            background: 'var(--mt-panel)', border: '1px solid var(--mt-border)',
            borderRadius: 4, padding: '4px 10px', fontSize: 11,
            color: 'var(--mt-text-muted)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}>
            ⚡ 事件因果脉络 · 拖拽连线创建因果链 · 右键展开参与者
          </div>
        </Panel>
      </ReactFlow>
      <ContextMenu />
    </div>
  );
}
