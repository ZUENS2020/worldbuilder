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

/** Stream SSE from a POST endpoint, calling onChunk for each text delta. */
async function streamPost(
  path: string,
  body: any,
  onChunk: (text: string) => void,
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`Stream error ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') return;
      // Restore newlines that were escaped for SSE transport
      onChunk(data.replace(/\\n/g, '\n'));
    }
  }
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

  // Documents (M4)
  listDocuments: (projectId: string, kind?: string) => {
    const q = kind ? `?kind=${kind}` : '';
    return request<any[]>(`/projects/${projectId}/documents${q}`);
  },
  createDocument: (projectId: string, data: { title: string; kind: string; content: string; refs?: any }) =>
    request<any>(`/projects/${projectId}/documents`, { method: 'POST', body: JSON.stringify(data) }),
  updateDocument: (projectId: string, id: string, data: any) =>
    request<any>(`/projects/${projectId}/documents/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteDocument: (projectId: string, id: string) =>
    request(`/projects/${projectId}/documents/${id}`, { method: 'DELETE' }),

  // Streaming generation (M2b/M4)
  generateStream: (
    projectId: string,
    data: { mode: string; context_entity_ids: string[]; context_event_ids: string[]; scene_description?: string },
    onChunk: (text: string) => void,
  ) => streamPost(`/projects/${projectId}/generate/stream`, data, onChunk),
};
