
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

export const api = {
  health: () => fetch(`${API_BASE}/api/health`).then(r => r.json()),
  checkLogin: () => fetch(`${API_BASE}/api/check-login`).then(r => r.json()),

  // Agent
  getAgents: (projectId?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    return fetch(`${API_BASE}/api/agents?${params}`).then(r => r.json());
  },
  getAgentMessages: (agentId: string, projectId?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    return fetch(`${API_BASE}/api/agents/${agentId}/messages?${params}`).then(r => r.json());
  },
  pauseAgent: (agentId: string, projectId?: string) =>
    fetch(`${API_BASE}/api/agents/${agentId}/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId })
    }).then(r => r.json()),
  resumeAgent: (agentId: string, projectId?: string) =>
    fetch(`${API_BASE}/api/agents/${agentId}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId })
    }).then(r => r.json()),
  getProposals: (projectId?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    return fetch(`${API_BASE}/api/proposals?${params}`).then(r => r.json());
  },
  getProposal: (id: string) => fetch(`${API_BASE}/api/proposals/${id}`).then(r => r.json()),
  createProposal: (data: any) =>
    fetch(`${API_BASE}/api/proposals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => r.json()),
  decideProposal: (id: string, decision: string, comment?: string) =>
    fetch(`${API_BASE}/api/proposals/${id}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision, comment })
    }).then(r => r.json()),
  getGames: (projectId?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    return fetch(`${API_BASE}/api/games?${params}`).then(r => r.json());
  },
  getGame: (id: string) => fetch(`${API_BASE}/api/games/${id}`).then(r => r.json()),
  getGamePreviewUrl: (id: string) => `${API_BASE}/api/games/${id}/preview`,
  getProjects: () => fetch(`${API_BASE}/api/projects`).then(r => r.json()),
  createProject: (data: { id: string; name?: string }) =>
    fetch(`${API_BASE}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => r.json()),
  switchProject: (fromProjectId: string | null, toProjectId: string) =>
    fetch(`${API_BASE}/api/projects/switch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromProjectId, toProjectId })
    }).then(r => r.json()),
  getProjectSettings: (projectId: string) =>
    fetch(`${API_BASE}/api/projects/${projectId}/settings`).then(r => r.json()),
  updateProjectSettings: (projectId: string, data: { autopilot_enabled: boolean }) =>
    fetch(`${API_BASE}/api/projects/${projectId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => r.json()),
  getLogs: (projectId?: string, agentId?: string) => {
    const params = new URLSearchParams();
    if (agentId) params.set('agentId', agentId);
    return fetch(`${API_BASE}/api/projects/${projectId || 'default'}/logs?${params}`).then(r => r.json());
  },
  deleteLogs: (projectId?: string, agentId?: string) => {
    const params = new URLSearchParams();
    if (agentId) params.set('agentId', agentId);
    const query = params.toString();
    return fetch(`${API_BASE}/api/projects/${projectId || 'default'}/logs${query ? `?${query}` : ''}`, { method: 'DELETE' }).then(r => r.json());
  },
  getCommands: (projectId?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    return fetch(`${API_BASE}/api/commands?${params}`).then(r => r.json());
  },
  getModels: () => fetch(`${API_BASE}/api/models`).then(r => r.json()),
  respondPermission: (requestId: string, behavior: 'allow' | 'deny', message?: string, projectId?: string, updatedInput?: Record<string, unknown>) =>
    fetch(`${API_BASE}/api/permission-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, behavior, message, projectId, updatedInput })
    }).then(r => r.json()),
  getHandoffs: (projectId?: string, agentId?: string, status?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (agentId) params.set('agentId', agentId);
    if (status) params.set('status', status);
    return fetch(`${API_BASE}/api/handoffs?${params}`).then(r => r.json());
  },
  getPendingHandoffs: (projectId?: string, toAgentId?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (toAgentId) params.set('toAgentId', toAgentId);
    return fetch(`${API_BASE}/api/handoffs/pending?${params}`).then(r => r.json());
  },
  createHandoff: (data: { project_id?: string; from_agent_id: string; to_agent_id: string; title: string; description: string; context?: string; priority?: string }) =>
    fetch(`${API_BASE}/api/handoffs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => r.json()),
  acceptHandoff: (id: string) =>
    fetch(`${API_BASE}/api/handoffs/${id}/accept`, { method: 'POST' }).then(r => r.json()),
  completeHandoff: (id: string, result?: string) =>
    fetch(`${API_BASE}/api/handoffs/${id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result })
    }).then(r => r.json()),
  rejectHandoff: (id: string, reason?: string) =>
    fetch(`${API_BASE}/api/handoffs/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    }).then(r => r.json()),
  cancelHandoff: (id: string) =>
    fetch(`${API_BASE}/api/handoffs/${id}/cancel`, { method: 'POST' }).then(r => r.json()),
  getTasks: (projectId?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    return fetch(`${API_BASE}/api/tasks?${params}`).then(r => r.json());
  },
  createTask: (data: {
    project_id?: string;
    title: string;
    description?: string;
    task_type: 'development' | 'testing';
    created_by: string;
    split_testing_task?: boolean;
  }) =>
    fetch(`${API_BASE}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => r.json()),
  updateTaskStatus: (id: string, status: 'todo' | 'developing' | 'testing' | 'blocked' | 'done', updated_by?: string) =>
    fetch(`${API_BASE}/api/tasks/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, updated_by })
    }).then(r => r.json()),
  getAgentMemories: (agentId: string, projectId?: string, category?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    if (category) params.set('category', category);
    return fetch(`${API_BASE}/api/agents/${agentId}/memories?${params}`).then(r => r.json());
  },
  createMemory: (agentId: string, data: { category?: string; content: string; importance?: string; source_task?: string; projectId?: string }) =>
    fetch(`${API_BASE}/api/agents/${agentId}/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => r.json()),
  deleteMemory: (id: string) =>
    fetch(`${API_BASE}/api/memories/${id}`, { method: 'DELETE' }).then(r => r.json()),
  observeUrl: (projectId?: string) => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    return `${API_BASE}/api/observe?${params}`;
  },
  commandAgentUrl: (agentId: string) => `${API_BASE}/api/agents/${agentId}/command`,
  commandAgent: (agentId: string, message: string, model?: string, projectId?: string) =>
    fetch(`${API_BASE}/api/agents/${agentId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, model: model || 'glm-5.0', projectId })
    })
};
