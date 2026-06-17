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
  getContext: (projectId: string, characters: string, scene?: string) => {
    const params = new URLSearchParams({ characters });
    if (scene) params.set('scene', scene);
    return request<any>(`/projects/${projectId}/entities/context?${params}`);
  },
};
