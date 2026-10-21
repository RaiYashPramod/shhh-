import type { ClientMsg, ServerMsg } from './protocol';

// Thin WebSocket wrapper. Same-origin /ws (Vite proxies it in dev).
export class Net {
  private ws: WebSocket | null = null;
  private listeners = new Set<(m: ServerMsg) => void>();
  onClose: () => void = () => undefined;

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    if (this.connected) return Promise.resolve();
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Could not reach the game server.'));
      ws.onclose = () => {
        this.ws = null;
        this.onClose();
      };
      ws.onmessage = (e) => {
        let m: ServerMsg;
        try {
          m = JSON.parse(e.data as string);
        } catch {
          return;
        }
        for (const l of this.listeners) l(m);
      };
    });
  }

  send(m: ClientMsg): void {
    if (this.connected) this.ws!.send(JSON.stringify(m));
  }

  on(fn: (m: ServerMsg) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
