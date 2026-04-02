export const API_BASE = 'http://localhost:3000';

export const api = {
  // 健康检查
  health: () => fetch(`${API_BASE}/api/health`).then(r => r.json()),

  // 登录检查
  checkLogin: () => fetch(`${API_BASE}/api/check-login`).then(r => r.json()),

  // Agent
  getAgents: () => fetch(`${API_BASE}/api/agents`).then(r => r.json()),
  getAgentMessages: (agentId: string) =>
    fetch(`${API_BASE}/api/agents/${agentId}/messages`).then(r => r.json()),
  pauseAgent: (agentId: string) =>
    fetch(`${API_BASE}/api/agents/${agentId}/pause`, { method: 'POST' }).then(r => r.json()),
  resumeAgent: (agentId: string) =>
    fetch(`${API_BASE}/api/agents/${agentId}/resume`, { method: 'POST' }).then(r => r.json()),

  // 提案
  getProposals: () => fetch(`${API_BASE}/api/proposals`).then(r => r.json()),
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

  // 游戏
  getGames: () => fetch(`${API_BASE}/api/games`).then(r => r.json()),
  getGame: (id: string) => fetch(`${API_BASE}/api/games/${id}`).then(r => r.json()),
  getGamePreviewUrl: (id: string) => `${API_BASE}/api/games/${id}/preview`,

  // 日志
  getLogs: (agentId?: string, limit?: number) => {
    const params = new URLSearchParams();
    if (agentId) params.set('agentId', agentId);
    if (limit) params.set('limit', String(limit));
    return fetch(`${API_BASE}/api/logs?${params}`).then(r => r.json());
  },

  // 指令历史
  getCommands: () => fetch(`${API_BASE}/api/commands`).then(r => r.json()),

  // 查询可用模型
  getModels: () => fetch(`${API_BASE}/api/models`).then(r => r.json()),

  // 权限响应
  respondPermission: (requestId: string, behavior: 'allow' | 'deny', message?: string) =>
    fetch(`${API_BASE}/api/permission-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, behavior, message })
    }).then(r => r.json()),

  // 任务交接
  getHandoffs: (agentId?: string, status?: string) => {
    const params = new URLSearchParams();
    if (agentId) params.set('agentId', agentId);
    if (status) params.set('status', status);
    return fetch(`${API_BASE}/api/handoffs?${params}`).then(r => r.json());
  },
  getPendingHandoffs: (toAgentId?: string) => {
    const params = new URLSearchParams();
    if (toAgentId) params.set('toAgentId', toAgentId);
    return fetch(`${API_BASE}/api/handoffs/pending?${params}`).then(r => r.json());
  },
  createHandoff: (data: { from_agent_id: string; to_agent_id: string; title: string; description: string; context?: string; priority?: string }) =>
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

  // Agent 记忆
  getAgentMemories: (agentId: string, category?: string) => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    return fetch(`${API_BASE}/api/agents/${agentId}/memories?${params}`).then(r => r.json());
  },
  createMemory: (agentId: string, data: { category?: string; content: string; importance?: string; source_task?: string }) =>
    fetch(`${API_BASE}/api/agents/${agentId}/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(r => r.json()),
  deleteMemory: (id: string) =>
    fetch(`${API_BASE}/api/memories/${id}`, { method: 'DELETE' }).then(r => r.json()),

  // SSE 观测流
  observeUrl: `${API_BASE}/api/observe`,

  // 发送指令 (SSE)
  commandAgentUrl: (agentId: string) => `${API_BASE}/api/agents/${agentId}/command`,
  commandAgent: (agentId: string, message: string, model?: string) =>
    fetch(`${API_BASE}/api/agents/${agentId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, model: model || 'glm-5.0' })
    })
};
