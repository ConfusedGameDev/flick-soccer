import type { ClientMessage, ServerMessage } from './protocol';

type Listener = (msg: ServerMessage) => void;

/** JSON WebSocket with auto-reconnect; `onReconnect` lets the owner resume its room. */
export class Socket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  /** Messages nobody was waiting for yet (the server can run ahead of the client's animations). */
  private pending: ServerMessage[] = [];
  private waiters = new Set<(msg: ServerMessage) => boolean>();
  private closedByUser = false;
  private backoffMs = 500;
  private everOpened = false;
  onReconnect: () => void = () => {};
  onStatus: (s: 'connecting' | 'open' | 'reconnecting' | 'closed') => void = () => {};

  constructor(private readonly url: string) {}

  connect(): Promise<void> {
    this.closedByUser = false;
    return new Promise((resolve, reject) => {
      this.onStatus(this.everOpened ? 'reconnecting' : 'connecting');
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        reject(e);
        return;
      }
      this.ws = ws;
      let settled = false;
      ws.onopen = () => {
        settled = true;
        this.backoffMs = 500;
        const reconnect = this.everOpened;
        this.everOpened = true;
        this.onStatus('open');
        if (reconnect) this.onReconnect();
        resolve();
      };
      ws.onmessage = (e) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(String(e.data)) as ServerMessage;
        } catch {
          return;
        }
        for (const l of [...this.listeners]) l(msg);
        // Flow messages are consumed exactly once, in order, by next(); queue them until asked for.
        let taken = false;
        for (const w of [...this.waiters]) {
          if (w(msg)) {
            taken = true;
            break;
          }
        }
        if (!taken) this.pending.push(msg);
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('Could not reach the match server'));
        }
      };
      ws.onclose = () => {
        this.ws = null;
        if (this.closedByUser) {
          this.onStatus('closed');
          return;
        }
        if (!settled) return; // the error path already rejected
        // Reconnect with backoff; the server keeps the seat for a while.
        this.onStatus('reconnecting');
        const wait = this.backoffMs;
        this.backoffMs = Math.min(8000, this.backoffMs * 2);
        setTimeout(() => {
          if (!this.closedByUser) this.connect().catch(() => {});
        }, wait);
      };
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Resolve with the next message whose type is in `types`, including ones that arrived earlier. */
  next<T extends ServerMessage['t']>(types: readonly T[]): Promise<Extract<ServerMessage, { t: T }>> {
    const wanted = types as readonly string[];
    const i = this.pending.findIndex((m) => wanted.includes(m.t));
    if (i >= 0) {
      const [msg] = this.pending.splice(i, 1);
      return Promise.resolve(msg as Extract<ServerMessage, { t: T }>);
    }
    return new Promise((resolve) => {
      const waiter = (msg: ServerMessage): boolean => {
        if (!wanted.includes(msg.t)) return false;
        this.waiters.delete(waiter);
        resolve(msg as Extract<ServerMessage, { t: T }>);
        return true;
      };
      this.waiters.add(waiter);
    });
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
    this.ws = null;
    this.listeners.clear();
    this.waiters.clear();
    this.pending = [];
  }
}
