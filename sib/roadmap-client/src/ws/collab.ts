// collab.ts — WebSocket client for /mindmap/ws.
// Thin transport: connect, auto-reconnect with backoff, JSON frames in/out.
// All state handling lives in the store's event handler (UI-free here).

import type { MindmapWsEvent } from '@spatial/shared';
import { getApiKey } from '../api/mindmap-api.js';

export type CollabStatus = 'connecting' | 'connected' | 'disconnected';

export class CollabClient {
  private socket: WebSocket | null = null;
  private closedByUser = false;
  private retryMs = 1000;

  constructor(
    private readonly mapId: string,
    private readonly clientName: string,
    private readonly onEvent: (event: MindmapWsEvent) => void,
    private readonly onStatus: (status: CollabStatus) => void,
  ) {}

  connect(): void {
    this.closedByUser = false;
    this.onStatus('connecting');

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const params = new URLSearchParams({ mapId: this.mapId, name: this.clientName });
    const key = getApiKey();
    if (key) params.set('key', key);

    const ws = new WebSocket(`${proto}://${location.host}/mindmap/ws?${params}`);
    this.socket = ws;

    ws.onopen = () => {
      this.retryMs = 1000;
      this.onStatus('connected');
    };
    ws.onmessage = e => {
      try { this.onEvent(JSON.parse(String(e.data)) as MindmapWsEvent); }
      catch { /* drop malformed frame */ }
    };
    ws.onclose = () => {
      this.onStatus('disconnected');
      if (!this.closedByUser) {
        setTimeout(() => this.connect(), this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 15_000);
      }
    };
    ws.onerror = () => ws.close();
  }

  send(type: MindmapWsEvent['type'], payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      const event: MindmapWsEvent = { type, mapId: this.mapId, ts: Date.now(), payload };
      this.socket.send(JSON.stringify(event));
    }
  }

  close(): void {
    this.closedByUser = true;
    this.socket?.close();
    this.socket = null;
  }
}
