/**
 */
import express from 'express';

class SSEBroadcaster {
  private clientsByProject = new Map<string, Set<express.Response>>();
  private ts = () => new Date().toISOString();

  addClient(res: express.Response, projectId: string = 'default'): void {
    console.error(`[SSE] ${this.ts()} addClient projectId=${projectId}`);
    if (!this.clientsByProject.has(projectId)) {
      this.clientsByProject.set(projectId, new Set());
    }
    this.clientsByProject.get(projectId)!.add(res);
    const totalClients = this.clientsByProject.get(projectId)!.size;
    console.error(`[SSE] ${this.ts()} addClient done projectId=${projectId} totalClients=${totalClients}`);
  }

  removeClient(res: express.Response): void {
    console.error(`[SSE] ${this.ts()} removeClient start`);
    let removedFrom: string[] = [];
    for (const [pid, clients] of this.clientsByProject.entries()) {
      if (clients.has(res)) {
        clients.delete(res);
        removedFrom.push(pid);
      }
    }
    console.error(`[SSE] ${this.ts()} removeClient done removedFrom=${JSON.stringify(removedFrom)}`);
  }

  broadcast(event: object, projectId?: string): void {
    // 安全加固：无 projectId 时跳过广播，防止事件泄露给所有已连接的 SSE 客户端
    if (!projectId) {
      console.error(`[SSE] ${this.ts()} broadcast skipped: no projectId eventType=${(event as any)?.type || 'unknown'}`);
      return;
    }

    const clients = this.clientsByProject.get(projectId);
    if (!clients || clients.size === 0) {
      console.error(`[SSE] ${this.ts()} broadcast skipped: no clients for projectId=${projectId} eventType=${(event as any)?.type || 'unknown'}`);
      return;
    }

    const eventType = (event as any)?.type || 'unknown';
    const data = `data: ${JSON.stringify(event)}\n\n`;
    let successCount = 0;
    let failCount = 0;
    for (const client of clients) {
      try {
        client.write(data);
        successCount++;
      } catch (e) {
        clients.delete(client);
        failCount++;
      }
    }
    console.error(`[SSE] ${this.ts()} broadcast done projectId=${projectId} eventType=${eventType} success=${successCount} fail=${failCount} totalClients=${clients.size}`);
  }
}

export const sseBroadcaster = new SSEBroadcaster();
