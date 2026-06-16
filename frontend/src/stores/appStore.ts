import { create } from 'zustand';
import type { Entity, Relation, Project, TransformDef, TransformResult, Tag, CustomRelationType } from '../types';
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
  setSelectedEntity: (id: string | null) => void;

  // Focus (highlight + fitView to a node in the graph)
  focusEntityId: string | null;
  focusNonce: number;
  focusOnEntity: (id: string) => void;

  // Context menu
  contextMenu: { x: number; y: number; entityId: string } | null;
  setContextMenu: (menu: { x: number; y: number; entityId: string } | null) => void;

  // Transforms
  transforms: TransformDef[];
  loadTransforms: (entityType: string) => Promise<void>;
  executeTransform: (entityId: string, transformType: string) => Promise<TransformResult | null>;

  // AI Candidates (M2c: preview before commit)
  aiCandidates: AICandidate[];
  setAiCandidates: (c: AICandidate[]) => void;
  acceptCandidates: (selected: AICandidate[]) => Promise<void>;

  // Loading
  loading: boolean;
  setLoading: (l: boolean) => void;

  // Layout (Maltego UI) — radial only
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
      focusEntityId: null,
      focusNonce: 0,
      contextMenu: null,
      aiCandidates: [],
      documents: [],
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
      set({ project, entities, relations, tags, customRelationTypes, loading: false });
    } catch (e) {
      console.error('Failed to load project:', e);
      set({ loading: false });
    }
  },

  addEntity: async (data) => {
    const projectId = get().project?.id;
    if (!projectId) throw new Error('No project selected');
    const entity = await api.createEntity(projectId, data);
    set((s) => ({ entities: [...s.entities, entity] }));
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
    set((s) => ({
      entities: s.entities.filter((e) => e.id !== id),
      relations: s.relations.filter((r) => r.source_id !== id && r.target_id !== id),
      selectedEntityId: s.selectedEntityId === id ? null : s.selectedEntityId,
    }));
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
  setSelectedEntity: (id) => set({ selectedEntityId: id }),

  focusEntityId: null,
  focusNonce: 0,
  focusOnEntity: (id) => set((s) => ({
    selectedEntityId: id,
    focusEntityId: id,
    focusNonce: s.focusNonce + 1,
  })),

  contextMenu: null,
  setContextMenu: (menu) => set({ contextMenu: menu }),

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
      return result;
    } catch (e) {
      console.error('Transform failed:', e);
      return null;
    }
  },

  // AI Candidates
  aiCandidates: [],
  setAiCandidates: (c) => set({ aiCandidates: c }),
  acceptCandidates: async (selected) => {
    const projectId = get().project?.id;
    if (!projectId) return;
    // Commit selected candidates using existing entity/relation create APIs
    for (const c of selected) {
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
      // Create relation
      await get().addRelation({
        source_id: c.source_entity_id,
        target_id: targetId,
        type: c.relation_type,
        properties: { description: c.description, ai_inferred: true, confidence: c.confidence },
        weight: c.confidence,
      });
    }
    set({ aiCandidates: [] });
  },

  loading: false,
  setLoading: (l) => set({ loading: l }),

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
