/**
 * SSE 广播器 - 共享模块，供多个文件使用
 */
import express from 'express';

class SSEBroadcaster {
  private clients = new Set<express.Response>();

  addClient(res: express.Response): void {
    this.clients.add(res);
  }

  removeClient(res: express.Response): void {
    this.clients.delete(res);
  }

  broadcast(event: object): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(data);
      } catch (e) {
        this.clients.delete(client);
      }
    }
  }
}

export const sseBroadcaster = new SSEBroadcaster();
