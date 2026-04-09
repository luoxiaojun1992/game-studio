/**
 * comment
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
    const data = `data: ${JSON.stringify(event)}\n\n`;

    const targets = projectId
      ? [this.clientsByProject.get(projectId) || new Set<express.Response>()]
      : Array.from(this.clientsByProject.values());

    for (const clients of targets) {
      for (const client of clients) {
        try {
          client.write(data);
        } catch (e) {
          clients.delete(client);
        }
      }
    }
  }
}

export const sseBroadcaster = new SSEBroadcaster();
