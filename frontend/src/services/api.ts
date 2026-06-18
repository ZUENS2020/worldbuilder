const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API Error ${res.status}: ${err}`);
  }
  return res.json();
}

// --- Projects ---
export const api = {
  // Projects
  listProjects: () => request<any[]>('/projects'),
  createProject: (data: { name: string; description?: string }) =>
    request<any>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  getProject: (id: string) => request<any>(`/projects/${id}`),
  updateProject: (id: string, data: any) =>
    request<any>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProject: (id: string) =>
    request(`/projects/${id}`, { method: 'DELETE' }),
  duplicateProject: (id: string) =>
    request<any>(`/projects/${id}/duplicate`, { method: 'POST' }),
  exportProject: (id: string) =>
    request<any>(`/projects/${id}/export`),
  // Graph import is new-project only — creates a fresh project from a bundle.
  importProject: (bundle: any) =>
    request<any>(`/projects/import`, { method: 'POST', body: JSON.stringify(bundle) }),

  // Entities
  listEntities: (projectId: string) => request<any[]>(`/projects/${projectId}/entities`),
  createEntity: (projectId: string, data: { name: string; type: string; properties?: any }) =>
    request<any>(`/projects/${projectId}/entities`, { method: 'POST', body: JSON.stringify(data) }),
  updateEntity: (projectId: string, id: string, data: any) =>
    request<any>(`/projects/${projectId}/entities/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEntity: (projectId: string, id: string) =>
    request(`/projects/${projectId}/entities/${id}`, { method: 'DELETE' }),
  getNeighbors: (projectId: string, entityId: string, hop = 2) =>
    request<any>(`/projects/${projectId}/entities/${entityId}/neighbors?hop=${hop}`),
  importCharacterCard: (projectId: string, card: unknown) =>
    request<any>(`/projects/${projectId}/entities/import-card`, { method: 'POST', body: JSON.stringify(card) }),

  // Relations
  listRelations: (projectId: string) => request<any[]>(`/projects/${projectId}/relations`),
  createRelation: (projectId: string, data: { source_id: string; target_id: string; type: string; properties?: any; weight?: number }) =>
    request<any>(`/projects/${projectId}/relations`, { method: 'POST', body: JSON.stringify(data) }),
  updateRelation: (projectId: string, id: string, data: any) =>
    request<any>(`/projects/${projectId}/relations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteRelation: (projectId: string, id: string) =>
    request(`/projects/${projectId}/relations/${id}`, { method: 'DELETE' }),

  // Transforms
  getTransforms: (projectId: string, entityType: string) =>
    request<any[]>(`/projects/${projectId}/transforms/${entityType}`),
  executeTransform: (projectId: string, data: { entity_id: string; transform_type: string; params?: any }) =>
    request<any>(`/projects/${projectId}/transforms/execute`, { method: 'POST', body: JSON.stringify(data) }),

  // Context (ST plugin)
  getContext: (projectId: string, characters: string, scene?: string, observer?: string) => {
    const params = new URLSearchParams({ characters });
    if (scene) params.set('scene', scene);
    if (observer) params.set('observer', observer);
    return request<any>(`/projects/${projectId}/entities/context?${params}`);
  },

  // Simulations (P1)
  createSimulation: (projectId: string, data: { name?: string; driver_mode?: string; config?: any }) =>
    request<any>(`/projects/${projectId}/simulations`, { method: 'POST', body: JSON.stringify(data) }),
  listSimulations: (projectId: string) =>
    request<any[]>(`/projects/${projectId}/simulations`),
  getSimulation: (projectId: string, simId: string) =>
    request<any>(`/projects/${projectId}/simulations/${simId}`),
  stepSimulation: (projectId: string, simId: string) =>
    request<any>(`/projects/${projectId}/simulations/${simId}/step`, { method: 'POST' }),

  // P5: background loop control + replay/reset
  playSimulation: (projectId: string, simId: string) =>
    request<any>(`/projects/${projectId}/simulations/${simId}/play`, { method: 'POST' }),
  pauseSimulation: (projectId: string, simId: string) =>
    request<any>(`/projects/${projectId}/simulations/${simId}/pause`, { method: 'POST' }),
  resetSimulation: (projectId: string, simId: string) =>
    request<any>(`/projects/${projectId}/simulations/${simId}/reset`, { method: 'POST' }),
  // Raw SSE endpoint URL — consumed via EventSource in the store.
  streamUrl: (projectId: string, simId: string) =>
    `${API_BASE}/projects/${projectId}/simulations/${simId}/stream`,
  getTick: (projectId: string, simId: string, tick: number) =>
    request<any>(`/projects/${projectId}/simulations/${simId}/ticks/${tick}`),
  patchSimConfig: (projectId: string, simId: string, body: { driver_mode?: string; config?: Record<string, any> }) =>
    request<any>(`/projects/${projectId}/simulations/${simId}/config`, {
      method: 'PATCH', body: JSON.stringify(body),
    }),

  getTicks: (projectId: string, simId: string, from?: number, to?: number) => {
    const params = new URLSearchParams();
    if (from != null) params.set('from', String(from));
    if (to != null) params.set('to', String(to));
    const qs = params.toString();
    return request<any[]>(`/projects/${projectId}/simulations/${simId}/ticks${qs ? `?${qs}` : ''}`);
  },
  getMemory: (projectId: string, simId: string, entityId: string) =>
    request<any[]>(`/projects/${projectId}/simulations/${simId}/memory?entity=${entityId}`),
  getBeliefs: (projectId: string, simId: string, observerId: string) =>
    request<any[]>(`/projects/${projectId}/simulations/${simId}/beliefs?observer=${observerId}`),

  seedBeliefs: (projectId: string) =>
    request<{ created: number }>(`/projects/${projectId}/beliefs/seed`, { method: 'POST' }),

  getBeliefContext: (projectId: string, observer: string, characters: string, hop?: number) => {
    const params = new URLSearchParams({ observer, characters });
    if (hop != null) params.set('hop', String(hop));
    return request<any>(`/projects/${projectId}/beliefs/context?${params}`);
  },

  getMemoryBlock: (projectId: string, simId: string, entity: string, recentK = 8) =>
    request<{ block: string; token_count: number }>(
      `/projects/${projectId}/simulations/${simId}/memory-block?entity=${encodeURIComponent(entity)}&recent_k=${recentK}`,
    ),

  listWriteback: (projectId: string, simId: string, status = 'pending') =>
    request<{ items: any[]; pending_count: number }>(
      `/projects/${projectId}/simulations/${simId}/st-writeback?status=${status}`,
    ),
  queueWriteback: (projectId: string, simId: string, body: object) =>
    request<any>(`/projects/${projectId}/simulations/${simId}/st-writeback/queue`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  previewWriteback: (projectId: string, simId: string, ids: string[], depth: string) =>
    request<any>(`/projects/${projectId}/simulations/${simId}/st-writeback/preview`, {
      method: 'POST', body: JSON.stringify({ ids, depth }),
    }),
  applyWriteback: (projectId: string, simId: string, ids: string[], depth?: string) =>
    request<any>(`/projects/${projectId}/simulations/${simId}/st-writeback/apply`, {
      method: 'POST', body: JSON.stringify({ ids, depth }),
    }),
  discardWriteback: (projectId: string, simId: string, itemId: string) =>
    request(`/projects/${projectId}/simulations/${simId}/st-writeback/${itemId}`, { method: 'DELETE' }),
  patchWritebackConfig: (projectId: string, simId: string, patch: object) =>
    request<any>(`/projects/${projectId}/simulations/${simId}/st-writeback/config`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }),

  // World Book (P3)
  listWorldEntries: (projectId: string) =>
    request<any[]>(`/projects/${projectId}/world-entries`),
  createWorldEntry: (projectId: string, data: {
    title?: string; content?: string; scope?: string;
    entity_ids?: string[]; keys?: string[]; priority?: number; enabled?: number; properties?: any;
  }) =>
    request<any>(`/projects/${projectId}/world-entries`, { method: 'POST', body: JSON.stringify(data) }),
  updateWorldEntry: (projectId: string, entryId: string, data: any) =>
    request<any>(`/projects/${projectId}/world-entries/${entryId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWorldEntry: (projectId: string, entryId: string) =>
    request(`/projects/${projectId}/world-entries/${entryId}`, { method: 'DELETE' }),
  exportWorldEntries: (projectId: string) =>
    request<any>(`/projects/${projectId}/world-entries/export`),
  // Import into the CURRENT project (appends). Accepts native or SillyTavern JSON.
  importWorldEntries: (projectId: string, payload: any) =>
    request<any[]>(`/projects/${projectId}/world-entries/import`, { method: 'POST', body: JSON.stringify(payload) }),
};
