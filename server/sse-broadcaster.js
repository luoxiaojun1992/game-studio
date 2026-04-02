class SSEBroadcaster {
    clients = new Set();
    addClient(res) {
        this.clients.add(res);
    }
    removeClient(res) {
        this.clients.delete(res);
    }
    broadcast(event) {
        const data = `data: ${JSON.stringify(event)}\n\n`;
        for (const client of this.clients) {
            try {
                client.write(data);
            }
            catch (e) {
                this.clients.delete(client);
            }
        }
    }
}
export const sseBroadcaster = new SSEBroadcaster();
