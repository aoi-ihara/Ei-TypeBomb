"use client";

import { io as socketIo } from "socket.io-client";
import { decodeJwt } from "jose";
import { getAuthToken } from "./auth";

// Only the event API used by the game is shared; Workers uses native WebSocket.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void;
type Options = {
  reconnection?: boolean;
  timeout?: number;
  autoConnect?: boolean;
  forceNew?: boolean;
  healthOnly?: boolean;
};

export class WorkerSocket {
  id?: string;
  connected = false;
  private listeners = new Map<string, Set<Listener>>();
  private ws?: WebSocket;
  private stopped = false;
  private heartbeat?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  private retry?: ReturnType<typeof setTimeout>;
  private attempt = 0;

  constructor(
    private url: string,
    private options: Options = {},
  ) {
    if (options.autoConnect !== false) void this.connect();
  }
  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }
  once(event: string, listener: Listener) {
    const wrapper: Listener = (...args) => {
      this.off(event, wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }
  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }
  private dispatch(event: string, data?: unknown) {
    for (const listener of [...(this.listeners.get(event) ?? [])])
      listener(data);
  }
  emit(event: string, data?: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ event, data }));
    return this;
  }
  async connect() {
    this.stopped = false;
    const attempt = ++this.attempt;
    this.timeout = setTimeout(() => {
      if (attempt !== this.attempt || this.connected || this.stopped) return;
      this.failed();
    }, this.options.timeout ?? 10_000);
    try {
      const token = await getAuthToken();
      if (this.stopped || attempt !== this.attempt) return;
      let roomId = "health";
      if (token && !this.options.healthOnly) {
        try {
          const id = decodeJwt(token).id;
          if (typeof id === "string") roomId = id;
        } catch {
          /* Auth handler reports invalid tokens. */
        }
      }
      const url = new URL(this.url);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = `/ws/${encodeURIComponent(roomId)}`;
      url.search = "";
      url.hash = "";
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onmessage = (message) => {
        if (this.stopped || attempt !== this.attempt) return;
        const packet = JSON.parse(message.data);
        if (packet.event === "connect") {
          clearTimeout(this.timeout);
          this.id = packet.data.id;
          this.connected = true;
          this.heartbeat = setInterval(() => this.emit("ping"), 25_000);
          this.dispatch("connect");
        } else if (packet.event !== "pong")
          this.dispatch(packet.event, packet.data);
      };
      ws.onerror = () => {
        if (attempt === this.attempt && !this.stopped) this.failed();
      };
      ws.onclose = () => {
        if (attempt === this.attempt && !this.stopped) this.failed();
      };
    } catch {
      if (attempt === this.attempt && !this.stopped) this.failed();
    }
    return this;
  }
  private failed() {
    const connected = this.connected;
    this.cleanup();
    this.dispatch(
      connected ? "disconnect" : "connect_error",
      new Error("Worker connection closed"),
    );
    if (!this.stopped && this.options.reconnection !== false)
      this.retry = setTimeout(() => {
        void this.connect();
      }, 1000);
  }
  private cleanup() {
    this.attempt++;
    clearTimeout(this.timeout);
    clearInterval(this.heartbeat);
    clearTimeout(this.retry);
    this.ws?.close();
    this.ws = undefined;
    this.connected = false;
    this.id = undefined;
  }
  disconnect() {
    this.stopped = true;
    this.cleanup();
    return this;
  }
}

/** A URL ending in /ws explicitly selects Workers, including custom domains. */
export function io(url?: string, options?: Options) {
  let isWorker = false;
  try {
    isWorker = !!url && new URL(url).pathname.replace(/\/$/, "") === "/ws";
  } catch {
    /* Preserve Socket.IO relative URL support. */
  }
  return isWorker ? new WorkerSocket(url!, options) : socketIo(url, options);
}
