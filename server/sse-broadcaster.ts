/**
 */
import express from 'express';

class SSEBroadcaster {
  private clientsByProject = new Map<string, Set<express.Response>>();

  addClient(res: express.Response, projectId: string = 'default'): void {
    if (!this.clientsByProject.has(projectId)) {
      this.clientsByProject.set(projectId, new Set());
    }
    this.clientsByProject.get(projectId)!.add(res);
  }

  removeClient(res: express.Response): void {
    for (const clients of this.clientsByProject.values()) {
      clients.delete(res);
    }
  }

  broadcast(event: object, projectId?: string): void {
    // 安全加固：无 projectId 时跳过广播，防止事件泄露给所有已连接的 SSE 客户端
    if (!projectId) return;

    const clients = this.clientsByProject.get(projectId);
    if (!clients || clients.size === 0) return;

    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
      try {
        client.write(data);
      } catch (e) {
        clients.delete(client);
      }
    }
  }
}

export const sseBroadcaster = new SSEBroadcaster();
