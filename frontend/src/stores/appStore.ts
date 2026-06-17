import { create } from 'zustand';
import type { Entity, Relation, Project, TransformDef, TransformResult, Tag, CustomRelationType } from '../types';
import { getGraphHops } from '../types';
import { api } from '../services/api';

interface AICandidate {
  target_name: string;
  target_type: string;
  relation_type: string;
  description: string;
  confidence: number;
  exists: boolean;
  source_entity_id: string;
}

interface Document {
  id: string;
  project_id: string;
  title: string;
  kind: string;
  content: string;
  refs: Record<string, any>;
  created_at: string | null;
  updated_at: string | null;
}

interface AppState {
  // Project
  project: Project | null;
  projects: Project[];
  setProject: (p: Project | null) => void;
  loadProjects: () => Promise<void>;
  switchProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  // Entities & Relations
  entities: Entity[];
  relations: Relation[];
  loadProjectData: (projectId: string) => Promise<void>;

  // Entity CRUD
  addEntity: (data: { name: string; type: string; properties?: any }) => Promise<Entity>;
  updateEntity: (id: string, data: any) => Promise<void>;
  removeEntity: (id: string) => Promise<void>;

  // Relation CRUD
  addRelation: (data: { source_id: string; target_id: string; type: string; properties?: any; weight?: number }) => Promise<Relation>;
  removeRelation: (id: string) => Promise<void>;

  // Selection
  selectedEntityId: string | null;
  selectedEntityIds: string[];
  setSelectedEntity: (id: string | null) => void;
  setSelectedEntities: (ids: string[]) => void;
  toggleEntitySelection: (id: string) => void;

  // Focus (highlight + fitView to a node in the graph)
  focusEntityId: string | null;
  focusNonce: number;
  focusOnEntity: (id: string) => void;

  // Inspector right panel tab
  inspectorTab: 'details' | 'transform';
  setInspectorTab: (tab: 'details' | 'transform') => void;

  // Transforms
  transforms: TransformDef[];
  loadTransforms: (entityType: string) => Promise<void>;
  executeTransform: (entityId: string, transformType: string) => Promise<TransformResult | null>;
  executeAllGraphTransforms: (entityId: string) => Promise<TransformResult | null>;
  // Highlight cluster on canvas after a Transform (persists until cleared).
  activeTransformHighlight: { entityIds: string[]; relationIds: string[] } | null;
  clearTransformHighlight: () => void;

  // Exploration mode (Maltego-style incremental reveal)
  // When on, the canvas only shows the "visible subgraph" — you pin a seed
  // and each Transform reveals more nodes around it.
  explorationMode: boolean;
  setExplorationMode: (b: boolean) => void;
  visibleEntityIds: Set<string>;
  pinEntity: (id: string) => void;
  unpinEntity: (id: string) => void;
  showAllEntities: () => void;
  isolateSubgraph: (id: string, hop?: number) => void;
  // Step history for the exploration canvas (undo / reset-to-start).
  explorationHistory: Set<string>[];
  explorationInitial: Set<string>;
  undoExploration: () => void;
  resetExploration: () => void;
  // Transient signal telling the Canvas to position + highlight + fit a reveal.
  // `fit: false` keeps the camera still (used for plain list selection).
  revealSignal: {
    nonce: number;
    pivotId: string;
    resultEntityIds: string[];
    newEntityIds: string[];
    relationIds: string[];
    fit?: boolean;
    persistHighlight?: boolean;
  } | null;
  // Select an entity (e.g. from the left Palette) without moving the camera.
  selectEntity: (id: string) => void;

  // AI Candidates (M2c: preview before commit)
  aiCandidates: AICandidate[];
  setAiCandidates: (c: AICandidate[]) => void;
  acceptCandidates: (selected: AICandidate[]) => Promise<void>;

  // Loading
  loading: boolean;
  setLoading: (l: boolean) => void;

  // Layout (Maltego UI) — switchable radial / force
  layoutMode: 'radial' | 'force';
  setLayoutMode: (m: 'radial' | 'force') => void;
  layoutNonce: number;
  requestAutoLayout: () => void;
  tidyUp: () => void;
  layouting: boolean;
  setLayouting: (b: boolean) => void;
  createOpen: boolean;
  setCreateOpen: (b: boolean) => void;
  dropRequest: { id: string; x: number; y: number } | null;
  setDropRequest: (d: { id: string; x: number; y: number } | null) => void;

  // View mode (M3: relations/events/writing)
  viewMode: 'relations' | 'events' | 'writing';
  setViewMode: (v: 'relations' | 'events' | 'writing') => void;

  // Documents (M4)
  documents: Document[];
  loadDocuments: () => Promise<void>;
  addDocument: (data: { title: string; kind: string; content: string; refs?: any }) => Promise<Document>;
  updateDocument: (id: string, data: any) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;

  // Settings dialog
  settingsOpen: boolean;
  setSettingsOpen: (b: boolean) => void;

  // Custom tags (folders) for user-defined entity grouping
  tags: Tag[];
  addTag: (name: string, color: string) => void;
  removeTag: (id: string) => void;
  renameTag: (id: string, name: string) => void;
  addEntityToTag: (entityId: string, tagId: string) => void;
  removeEntityFromTag: (entityId: string, tagId: string) => void;

  // Custom relation types (user-defined, persisted in Project.settings)
  customRelationTypes: CustomRelationType[];
  addCustomRelationType: (name: string, color: string, style: 'solid' | 'dashed' | 'dotted') => void;
  removeCustomRelationType: (id: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  project: null,
  projects: [],
  setProject: (p) => set({ project: p }),

  loadProjects: async () => {
    try {
      const projects = await api.listProjects();
      set({ projects });
    } catch (e) {
      console.error('Failed to load projects:', e);
    }
  },

  switchProject: async (id) => {
    // Reset selection/focus state before loading new project
    set({
      selectedEntityId: null,
      selectedEntityIds: [],
      focusEntityId: null,
      focusNonce: 0,
      aiCandidates: [],
      documents: [],
      visibleEntityIds: new Set<string>(),
      explorationHistory: [],
      explorationInitial: new Set<string>(),
      revealSignal: null,
      activeTransformHighlight: null,
      inspectorTab: 'details',
    });
    await get().loadProjectData(id);
    // Also refresh the project list to keep it in sync
    await get().loadProjects();
  },

  deleteProject: async (id) => {
    try {
      await api.deleteProject(id);
      const remaining = get().projects.filter((p) => p.id !== id);
      set({ projects: remaining });
      // If we deleted the current project, switch to another or go to list
      if (get().project?.id === id) {
        if (remaining.length > 0) {
          await get().switchProject(remaining[0].id);
        } else {
          set({ project: null, entities: [], relations: [], tags: [], customRelationTypes: [], documents: [] });
        }
      }
    } catch (e) {
      console.error('Failed to delete project:', e);
    }
  },

  entities: [],
  relations: [],

  loadProjectData: async (projectId) => {
    set({ loading: true });
    try {
      const [project, entities, relations] = await Promise.all([
        api.getProject(projectId),
        api.listEntities(projectId),
        api.listRelations(projectId),
      ]);
      const tags: Tag[] = Array.isArray(project?.settings?.tags) ? project.settings.tags : [];
      const customRelationTypes: CustomRelationType[] = Array.isArray(project?.settings?.customRelationTypes) ? project.settings.customRelationTypes : [];
      set({
        project, entities, relations, tags, customRelationTypes, loading: false,
        // In exploration mode, start from a clean canvas for the new project.
        visibleEntityIds: get().explorationMode ? new Set<string>() : get().visibleEntityIds,
        revealSignal: null,
      });
    } catch (e) {
      console.error('Failed to load project:', e);
      set({ loading: false });
    }
  },

  addEntity: async (data) => {
    const projectId = get().project?.id;
    if (!projectId) throw new Error('No project selected');
    const entity = await api.createEntity(projectId, data);
    set((s) => ({
      entities: [...s.entities, entity],
      // Newly created entities are auto-pinned so they show in exploration mode.
      visibleEntityIds: s.explorationMode
        ? new Set(s.visibleEntityIds).add(entity.id)
        : s.visibleEntityIds,
      explorationHistory: s.explorationMode
        ? _pushHist(s.explorationHistory, s.visibleEntityIds)
        : s.explorationHistory,
    }));
    return entity;
  },

  updateEntity: async (id, data) => {
    const projectId = get().project?.id;
    if (!projectId) return;
    const updated = await api.updateEntity(projectId, id, data);
    set((s) => ({ entities: s.entities.map((e) => (e.id === id ? updated : e)) }));
  },

  removeEntity: async (id) => {
    const projectId = get().project?.id;
    if (!projectId) return;
    await api.deleteEntity(projectId, id);
    set((s) => {
      const ids = s.selectedEntityIds.filter((eid) => eid !== id);
      return {
        entities: s.entities.filter((e) => e.id !== id),
        relations: s.relations.filter((r) => r.source_id !== id && r.target_id !== id),
        selectedEntityIds: ids,
        selectedEntityId: ids[0] ?? null,
      };
    });
  },

  addRelation: async (data) => {
    const projectId = get().project?.id;
    if (!projectId) throw new Error('No project selected');
    const relation = await api.createRelation(projectId, data);
    set((s) => ({ relations: [...s.relations, relation] }));
    return relation;
  },

  removeRelation: async (id) => {
    const projectId = get().project?.id;
    if (!projectId) return;
    await api.deleteRelation(projectId, id);
    set((s) => ({ relations: s.relations.filter((r) => r.id !== id) }));
  },

  selectedEntityId: null,
  selectedEntityIds: [],
  setSelectedEntity: (id) => set({
    selectedEntityId: id,
    selectedEntityIds: id ? [id] : [],
  }),
  setSelectedEntities: (ids) => set({
    selectedEntityIds: ids,
    selectedEntityId: ids[0] ?? null,
  }),
  toggleEntitySelection: (id) => set((s) => {
    const next = new Set(s.selectedEntityIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    const ids = [...next];
    return { selectedEntityIds: ids, selectedEntityId: ids[0] ?? null };
  }),

  selectEntity: (id) => set((s) => {
    // In exploration mode, selecting a not-yet-visible entity pins it onto the
    // canvas (positioned, but the camera stays put). Otherwise it's a pure
    // selection — the canvas only highlights the node, no panning/zooming.
    if (s.explorationMode && !s.visibleEntityIds.has(id)) {
      const next = new Set(s.visibleEntityIds);
      next.add(id);
      return {
        selectedEntityId: id,
        selectedEntityIds: [id],
        visibleEntityIds: next,
        explorationHistory: _pushHist(s.explorationHistory, s.visibleEntityIds),
        revealSignal: {
          nonce: (s.revealSignal?.nonce ?? 0) + 1,
          pivotId: id,
          resultEntityIds: [id],
          newEntityIds: [id],
          relationIds: [],
          fit: false,
        },
      };
    }
    return { selectedEntityId: id, selectedEntityIds: [id] };
  }),

  focusEntityId: null,
  focusNonce: 0,
  focusOnEntity: (id) => set((s) => {
    const base = {
      selectedEntityId: id,
      selectedEntityIds: [id],
      focusEntityId: id,
      focusNonce: s.focusNonce + 1,
    };
    if (s.explorationMode && !s.visibleEntityIds.has(id)) {
      const next = new Set(s.visibleEntityIds);
      next.add(id);
      return {
        ...base,
        visibleEntityIds: next,
        explorationHistory: _pushHist(s.explorationHistory, s.visibleEntityIds),
        revealSignal: {
          nonce: (s.revealSignal?.nonce ?? 0) + 1,
          pivotId: id,
          resultEntityIds: [id],
          newEntityIds: [id],
          relationIds: [],
          fit: true,
        },
      };
    }
    if (s.explorationMode) {
      return { ...base, visibleEntityIds: new Set(s.visibleEntityIds).add(id) };
    }
    return base;
  }),

  inspectorTab: 'details',
  setInspectorTab: (tab) => set({ inspectorTab: tab }),

  activeTransformHighlight: null,
  clearTransformHighlight: () => set({ activeTransformHighlight: null }),

  transforms: [],
  loadTransforms: async (entityType) => {
    const projectId = get().project?.id;
    if (!projectId) return;
    const transforms = await api.getTransforms(projectId, entityType);
    set({ transforms });
  },

  executeTransform: async (entityId, transformType) => {
    const projectId = get().project?.id;
    if (!projectId) return null;
    try {
      const result = await api.executeTransform(projectId, {
        entity_id: entityId,
        transform_type: transformType,
      });

      // M2c: ai_infer returns candidates instead of auto-committing
      if (transformType === 'ai_infer' && result.candidates && result.candidates.length > 0) {
        set({ aiCandidates: result.candidates });
        return result;
      }

      // Other transforms: merge results as before
      const mergeById = <T extends { id: string }>(existing: T[], incoming: T[]): T[] => {
        const byId = new Map(existing.map((x) => [x.id, x]));
        for (const item of incoming) byId.set(item.id, item);
        return Array.from(byId.values());
      };
      set((s) => ({
        entities: mergeById<Entity>(s.entities, result.new_entities),
        relations: mergeById<Relation>(s.relations, result.new_relations),
      }));

      // ── Incremental reveal: figure out what this Transform surfaced ──
      const s = get();
      const resultIds = new Set<string>([entityId]);
      for (const e of result.new_entities) resultIds.add(e.id);
      for (const r of result.new_relations) { resultIds.add(r.source_id); resultIds.add(r.target_id); }
      const beforeVisible = s.explorationMode
        ? s.visibleEntityIds
        : new Set(s.entities.map((e) => e.id));
      const newEntityIds = [...resultIds].filter((id) => !beforeVisible.has(id));
      const relationIds = result.new_relations.map((r: Relation) => r.id);

      if (s.explorationMode) {
        const nextVisible = new Set(s.visibleEntityIds);
        resultIds.forEach((id) => nextVisible.add(id));
        const grew = nextVisible.size > s.visibleEntityIds.size;
        set({
          visibleEntityIds: nextVisible,
          explorationHistory: grew ? _pushHist(s.explorationHistory, s.visibleEntityIds) : s.explorationHistory,
        });
      }
      set((st) => ({
        activeTransformHighlight: {
          entityIds: [...resultIds],
          relationIds,
        },
        revealSignal: {
          nonce: (st.revealSignal?.nonce ?? 0) + 1,
          pivotId: entityId,
          resultEntityIds: [...resultIds],
          newEntityIds,
          relationIds,
          persistHighlight: false,
        },
      }));
      return result;
    } catch (e) {
      console.error('Transform failed:', e);
      return null;
    }
  },

  executeAllGraphTransforms: async (entityId) => {
    const projectId = get().project?.id;
    if (!projectId) return null;
    const entity = get().entities.find((e) => e.id === entityId);
    if (!entity) return null;

    let transformList = get().transforms.filter((t) => !t.id.startsWith('ai_'));
    if (transformList.length === 0) {
      const allTransforms = await api.getTransforms(projectId, entity.type);
      set({ transforms: allTransforms });
      transformList = allTransforms.filter((t: TransformDef) => !t.id.startsWith('ai_'));
    }

    const mergeById = <T extends { id: string }>(existing: T[], incoming: T[]): T[] => {
      const byId = new Map(existing.map((x) => [x.id, x]));
      for (const item of incoming) byId.set(item.id, item);
      return Array.from(byId.values());
    };

    let mergedEntities = get().entities;
    let mergedRelations = get().relations;
    const resultIds = new Set<string>([entityId]);
    const relationIdSet = new Set<string>();

    for (const t of transformList) {
      try {
        const result = await api.executeTransform(projectId, {
          entity_id: entityId,
          transform_type: t.id,
        });
        mergedEntities = mergeById(mergedEntities, result.new_entities);
        mergedRelations = mergeById(mergedRelations, result.new_relations);
        for (const e of result.new_entities) resultIds.add(e.id);
        for (const r of result.new_relations) {
          resultIds.add(r.source_id);
          resultIds.add(r.target_id);
          relationIdSet.add(r.id);
        }
      } catch {
        /* keep going with remaining transforms */
      }
    }

    set({ entities: mergedEntities, relations: mergedRelations });

    const s = get();
    const beforeVisible = s.explorationMode
      ? s.visibleEntityIds
      : new Set(s.entities.map((e) => e.id));
    const newEntityIds = [...resultIds].filter((id) => !beforeVisible.has(id));
    const relationIds = [...relationIdSet];

    if (s.explorationMode) {
      const nextVisible = new Set(s.visibleEntityIds);
      resultIds.forEach((id) => nextVisible.add(id));
      const grew = nextVisible.size > s.visibleEntityIds.size;
      set({
        visibleEntityIds: nextVisible,
        explorationHistory: grew ? _pushHist(s.explorationHistory, s.visibleEntityIds) : s.explorationHistory,
      });
    }

    set((st) => ({
      activeTransformHighlight: {
        entityIds: [...resultIds],
        relationIds,
      },
      revealSignal: {
        nonce: (st.revealSignal?.nonce ?? 0) + 1,
        pivotId: entityId,
        resultEntityIds: [...resultIds],
        newEntityIds,
        relationIds,
        persistHighlight: true,
      },
    }));

    return {
      new_entities: mergedEntities.filter((e) => resultIds.has(e.id) && e.id !== entityId),
      new_relations: mergedRelations.filter((r) => relationIdSet.has(r.id)),
      message: `已展开 ${resultIds.size - 1} 个关联实体（${transformList.length} 个 Transform）`,
    };
  },

  // ── Exploration mode ──
  explorationMode: false,
  visibleEntityIds: new Set<string>(),
  revealSignal: null,

  setExplorationMode: (b) => set((s) => {
    if (b) {
      // Start the investigation from the currently selected node, if any.
      // Otherwise begin blank and let the empty-state prompt the user to pick.
      const seed = new Set<string>();
      if (s.selectedEntityId) seed.add(s.selectedEntityId);
      return {
        explorationMode: true,
        visibleEntityIds: seed,
        explorationInitial: new Set(seed),
        explorationHistory: [],
        revealSignal: s.selectedEntityId
          ? {
              nonce: (s.revealSignal?.nonce ?? 0) + 1,
              pivotId: s.selectedEntityId,
              resultEntityIds: [s.selectedEntityId],
              newEntityIds: [s.selectedEntityId],
              relationIds: [],
            }
          : null,
      };
    }
    return { explorationMode: false, revealSignal: null };
  }),

  explorationHistory: [],
  explorationInitial: new Set<string>(),

  pinEntity: (id) => set((s) => {
    if (s.visibleEntityIds.has(id)) {
      // Already on the canvas — just re-focus it (no new step).
      return {
        revealSignal: {
          nonce: (s.revealSignal?.nonce ?? 0) + 1,
          pivotId: id, resultEntityIds: [id], newEntityIds: [], relationIds: [],
        },
      };
    }
    const next = new Set(s.visibleEntityIds);
    next.add(id);
    return {
      visibleEntityIds: next,
      explorationHistory: _pushHist(s.explorationHistory, s.visibleEntityIds),
      revealSignal: {
        nonce: (s.revealSignal?.nonce ?? 0) + 1,
        pivotId: id,
        resultEntityIds: [id],
        newEntityIds: [id],
        relationIds: [],
      },
    };
  }),

  unpinEntity: (id) => set((s) => {
    if (!s.visibleEntityIds.has(id)) return {};
    const next = new Set(s.visibleEntityIds);
    next.delete(id);
    const ids = s.selectedEntityIds.filter((eid) => eid !== id);
    return {
      visibleEntityIds: next,
      explorationHistory: _pushHist(s.explorationHistory, s.visibleEntityIds),
      selectedEntityIds: ids,
      selectedEntityId: ids[0] ?? null,
    };
  }),

  undoExploration: () => set((s) => {
    if (s.explorationHistory.length === 0) return {};
    const history = [...s.explorationHistory];
    const prev = history.pop()!;
    return {
      visibleEntityIds: prev,
      explorationHistory: history,
      revealSignal: _fitReveal(s.revealSignal?.nonce ?? 0, [...prev], s.relations),
    };
  }),

  resetExploration: () => set((s) => ({
    visibleEntityIds: new Set(s.explorationInitial),
    explorationHistory: [],
    revealSignal: _fitReveal(s.revealSignal?.nonce ?? 0, [...s.explorationInitial], s.relations),
  })),

  showAllEntities: () => set((s) => ({
    visibleEntityIds: new Set(s.entities.map((e) => e.id)),
    explorationHistory: _pushHist(s.explorationHistory, s.visibleEntityIds),
    revealSignal: null,
  })),

  isolateSubgraph: (id, hop?) => set((s) => {
    const depth = hop ?? getGraphHops(s.project).isolate_subgraph;
    // BFS over current relations to collect everything within `depth` of `id`.
    const adjacency = new Map<string, string[]>();
    for (const r of s.relations) {
      if (!adjacency.has(r.source_id)) adjacency.set(r.source_id, []);
      if (!adjacency.has(r.target_id)) adjacency.set(r.target_id, []);
      adjacency.get(r.source_id)!.push(r.target_id);
      adjacency.get(r.target_id)!.push(r.source_id);
    }
    const visible = new Set<string>([id]);
    let frontier = [id];
    for (let h = 0; h < depth; h++) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const nb of adjacency.get(cur) ?? []) {
          if (!visible.has(nb)) { visible.add(nb); next.push(nb); }
        }
      }
      frontier = next;
    }
    const relationIds = s.relations
      .filter((r) => visible.has(r.source_id) && visible.has(r.target_id))
      .map((r) => r.id);
    return {
      explorationMode: true,
      visibleEntityIds: visible,
      selectedEntityId: id,
      selectedEntityIds: [id],
      // Isolating from overview starts a fresh investigation rooted at `id`.
      explorationInitial: s.explorationMode ? s.explorationInitial : new Set<string>([id]),
      explorationHistory: s.explorationMode ? _pushHist(s.explorationHistory, s.visibleEntityIds) : [],
      revealSignal: {
        nonce: (s.revealSignal?.nonce ?? 0) + 1,
        pivotId: id,
        resultEntityIds: [...visible],
        newEntityIds: [...visible].filter((eid) => eid !== id),
        relationIds,
      },
    };
  }),

  // AI Candidates
  aiCandidates: [],
  setAiCandidates: (c) => set({ aiCandidates: c }),
  acceptCandidates: async (selected) => {
    const projectId = get().project?.id;
    if (!projectId) return;
    // Commit selected candidates using existing entity/relation create APIs
    const revealedEntityIds = new Set<string>();
    const revealedRelationIds: string[] = [];
    let pivotId = '';
    for (const c of selected) {
      pivotId = pivotId || c.source_entity_id;
      revealedEntityIds.add(c.source_entity_id);
      // Find or create target entity
      let targetId: string;
      const existing = get().entities.find((e) => e.name === c.target_name);
      if (existing) {
        targetId = existing.id;
      } else {
        const created = await get().addEntity({
          name: c.target_name,
          type: c.target_type || 'character',
          properties: { ai_inferred: true, inference_source: c.source_entity_id },
        });
        targetId = created.id;
      }
      revealedEntityIds.add(targetId);
      // Create relation
      const rel = await get().addRelation({
        source_id: c.source_entity_id,
        target_id: targetId,
        type: c.relation_type,
        properties: { description: c.description, ai_inferred: true, confidence: c.confidence },
        weight: c.confidence,
      });
      revealedRelationIds.push(rel.id);
    }
    set({ aiCandidates: [] });

    // Reveal the freshly committed AI nodes (and pin them in exploration mode).
    if (pivotId) {
      set((s) => {
        const beforeVisible = s.explorationMode ? s.visibleEntityIds : new Set(s.entities.map((e) => e.id));
        const newEntityIds = [...revealedEntityIds].filter((id) => !beforeVisible.has(id));
        const nextVisible = s.explorationMode
          ? new Set([...s.visibleEntityIds, ...revealedEntityIds])
          : s.visibleEntityIds;
        const grew = s.explorationMode && nextVisible.size > s.visibleEntityIds.size;
        return {
          visibleEntityIds: nextVisible,
          explorationHistory: grew ? _pushHist(s.explorationHistory, s.visibleEntityIds) : s.explorationHistory,
          revealSignal: {
            nonce: (s.revealSignal?.nonce ?? 0) + 1,
            pivotId,
            resultEntityIds: [...revealedEntityIds],
            newEntityIds,
            relationIds: revealedRelationIds,
          },
        };
      });
    }
  },

  loading: false,
  setLoading: (l) => set({ loading: l }),

  layoutMode: 'radial',
  setLayoutMode: (m) => set({ layoutMode: m }),
  layoutNonce: 0,
  requestAutoLayout: () => set((s) => ({ layoutNonce: s.layoutNonce + 1 })),
  tidyUp: () => set((s) => ({
    layoutNonce: s.layoutNonce + 1,
  })),
  layouting: false,
  setLayouting: (b) => set({ layouting: b }),
  createOpen: false,
  setCreateOpen: (b) => set({ createOpen: b }),
  dropRequest: null,
  setDropRequest: (d) => set({ dropRequest: d }),

  // View mode
  viewMode: 'relations',
  setViewMode: (v) => set({ viewMode: v }),

  // Documents
  documents: [],
  loadDocuments: async () => {
    const projectId = get().project?.id;
    if (!projectId) return;
    const docs = await api.listDocuments(projectId);
    set({ documents: docs });
  },
  addDocument: async (data) => {
    const projectId = get().project?.id;
    if (!projectId) throw new Error('No project selected');
    const doc = await api.createDocument(projectId, data);
    set((s) => ({ documents: [...s.documents, doc] }));
    return doc;
  },
  updateDocument: async (id, data) => {
    const projectId = get().project?.id;
    if (!projectId) return;
    const updated = await api.updateDocument(projectId, id, data);
    set((s) => ({ documents: s.documents.map((d) => (d.id === id ? updated : d)) }));
  },
  removeDocument: async (id) => {
    const projectId = get().project?.id;
    if (!projectId) return;
    await api.deleteDocument(projectId, id);
    set((s) => ({ documents: s.documents.filter((d) => d.id !== id) }));
  },

  // Settings
  settingsOpen: false,
  setSettingsOpen: (b) => set({ settingsOpen: b }),

  // ── Custom tags (folders) ──
  // Tags are persisted in Project.settings.tags and also synced to the backend
  tags: [],

  addTag: (name, color) => {
    const id = `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newTag: Tag = { id, name, color, entityIds: [] };
    set((s) => {
      const tags = [...s.tags, newTag];
      _persistTags(tags, s.project);
      return { tags };
    });
  },

  removeTag: (id) => {
    set((s) => {
      const tags = s.tags.filter((t) => t.id !== id);
      _persistTags(tags, s.project);
      return { tags };
    });
  },

  renameTag: (id, name) => {
    set((s) => {
      const tags = s.tags.map((t) => t.id === id ? { ...t, name } : t);
      _persistTags(tags, s.project);
      return { tags };
    });
  },

  addEntityToTag: (entityId, tagId) => {
    set((s) => {
      const tags = s.tags.map((t) =>
        t.id === tagId && !t.entityIds.includes(entityId)
          ? { ...t, entityIds: [...t.entityIds, entityId] }
          : t
      );
      _persistTags(tags, s.project);
      return { tags };
    });
  },

  removeEntityFromTag: (entityId, tagId) => {
    set((s) => {
      const tags = s.tags.map((t) =>
        t.id === tagId
          ? { ...t, entityIds: t.entityIds.filter((eid) => eid !== entityId) }
          : t
      );
      _persistTags(tags, s.project);
      return { tags };
    });
  },

  // ── Custom relation types ──
  customRelationTypes: [],

  addCustomRelationType: (name, color, style) => {
    const id = `crt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newType: CustomRelationType = { id, name, color, style };
    set((s) => {
      const customRelationTypes = [...s.customRelationTypes, newType];
      _persistCustomRelationTypes(customRelationTypes, s.project);
      return { customRelationTypes };
    });
  },

  removeCustomRelationType: (id) => {
    set((s) => {
      const customRelationTypes = s.customRelationTypes.filter((t) => t.id !== id);
      _persistCustomRelationTypes(customRelationTypes, s.project);
      return { customRelationTypes };
    });
  },
}));

const HISTORY_LIMIT = 60;

/** Append a snapshot of the current visible set to the exploration history. */
function _pushHist(history: Set<string>[], current: Set<string>): Set<string>[] {
  return [...history, new Set(current)].slice(-HISTORY_LIMIT);
}

/** Build a reveal signal that just re-fits the camera to `ids` (no new nodes). */
function _fitReveal(nonce: number, ids: string[], relations: Relation[]) {
  const idSet = new Set(ids);
  const relationIds = relations
    .filter((r) => idSet.has(r.source_id) && idSet.has(r.target_id))
    .map((r) => r.id);
  return { nonce: nonce + 1, pivotId: '', resultEntityIds: ids, newEntityIds: [] as string[], relationIds };
}

/** Persist tags into Project.settings.tags and sync to backend. */
function _persistTags(tags: Tag[], project: Project | null) {
  if (!project) return;
  project.settings = { ...project.settings, tags };
  // Fire-and-forget backend sync
  api.updateProject(project.id, { settings: project.settings }).catch((e) =>
    console.error('Failed to persist tags:', e)
  );
}

/** Persist customRelationTypes into Project.settings and sync to backend. */
function _persistCustomRelationTypes(customRelationTypes: CustomRelationType[], project: Project | null) {
  if (!project) return;
  project.settings = { ...project.settings, customRelationTypes };
  api.updateProject(project.id, { settings: project.settings }).catch((e) =>
    console.error('Failed to persist custom relation types:', e)
  );
}
