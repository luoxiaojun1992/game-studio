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

  // 权限响应
  respondPermission: (requestId: string, behavior: 'allow' | 'deny', message?: string) =>
    fetch(`${API_BASE}/api/permission-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, behavior, message })
    }).then(r => r.json()),

  // SSE 观测流
  observeUrl: `${API_BASE}/api/observe`,

  // 发送指令 (SSE)
  commandAgentUrl: (agentId: string) => `${API_BASE}/api/agents/${agentId}/command`,
  commandAgent: (agentId: string, message: string, model?: string) =>
    fetch(`${API_BASE}/api/agents/${agentId}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, model: model || 'claude-sonnet-4' })
    })
};
