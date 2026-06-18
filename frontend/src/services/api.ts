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
