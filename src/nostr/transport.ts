import type { NostrEvent, NostrFilter, PublishResult, RelayEvent } from "../domain/types.js";
import { validateEventShape } from "./crypto.js";

export interface SubscriptionHandlers {
  onevent: (event: RelayEvent) => void;
  oneose?: (relay: string) => void;
  onnotice?: (relay: string, message: string) => void;
}

export interface NostrTransport {
  query(relays: readonly string[], filter: NostrFilter, options?: { maxWait?: number }): Promise<RelayEvent[]>;
  subscribe(relays: readonly string[], filter: NostrFilter, handlers: SubscriptionHandlers): () => void;
  publish(relays: readonly string[], event: NostrEvent, options?: { maxWait?: number }): Promise<PublishResult>;
  connectedRelays(): string[];
  onConnectionChange(listener: (connected: string[]) => void): () => void;
  close(): void;
}

interface RelaySubscription {
  filter: NostrFilter;
  handlers: SubscriptionHandlers;
}

interface PendingPublish {
  resolve: (result: { accepted: boolean; message: string }) => void;
  timer: number;
}

class RelayConnection {
  readonly url: string;
  readonly #stateChanged: () => void;
  #socket: WebSocket | null = null;
  #connecting: Promise<void> | null = null;
  #subscriptions = new Map<string, RelaySubscription>();
  #pendingPublishes = new Map<string, PendingPublish>();
  #reconnectTimer: number | null = null;
  #reconnectAttempt = 0;
  #closed = false;

  constructor(url: string, stateChanged: () => void) {
    this.url = url;
    this.#stateChanged = stateChanged;
  }

  get connected(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    if (this.#closed) throw new Error(`Relay ${this.url} is closed`);
    if (this.connected) return;
    if (this.#connecting) return this.#connecting;
    this.#connecting = new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(this.url);
      this.#socket = socket;
      const timeout = globalThis.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Timed out connecting to ${this.url}`));
          socket.close();
        }
      }, 6_000);

      socket.addEventListener("open", () => {
        globalThis.clearTimeout(timeout);
        this.#reconnectAttempt = 0;
        if (!settled) {
          settled = true;
          resolve();
        }
        this.#stateChanged();
        for (const [id, subscription] of this.#subscriptions) {
          this.#send(["REQ", id, subscription.filter]);
        }
      });

      socket.addEventListener("message", (message) => this.#handleMessage(message.data));
      socket.addEventListener("error", () => {
        if (!settled) {
          settled = true;
          globalThis.clearTimeout(timeout);
          reject(new Error(`Could not connect to ${this.url}`));
        }
      });
      socket.addEventListener("close", () => {
        globalThis.clearTimeout(timeout);
        this.#socket = null;
        this.#connecting = null;
        this.#stateChanged();
        if (!settled) {
          settled = true;
          reject(new Error(`Relay ${this.url} closed before connecting`));
        }
        for (const [eventId, pending] of this.#pendingPublishes) {
          globalThis.clearTimeout(pending.timer);
          pending.resolve({ accepted: false, message: "Relay disconnected" });
          this.#pendingPublishes.delete(eventId);
        }
        if (!this.#closed && this.#subscriptions.size > 0) this.#scheduleReconnect();
      });
    }).finally(() => {
      this.#connecting = null;
    });
    return this.#connecting;
  }

  subscribe(id: string, filter: NostrFilter, handlers: SubscriptionHandlers): void {
    this.#subscriptions.set(id, { filter, handlers });
    if (this.connected) {
      this.#send(["REQ", id, filter]);
      return;
    }
    // The open handler sends every stored subscription. Sending again in the
    // connect promise would issue a duplicate REQ on the first connection.
    void this.connect()
      .catch((error: unknown) => handlers.onnotice?.(this.url, error instanceof Error ? error.message : String(error)));
  }

  unsubscribe(id: string): void {
    if (!this.#subscriptions.delete(id)) return;
    if (this.connected) this.#send(["CLOSE", id]);
  }

  async publish(event: NostrEvent, maxWait: number): Promise<{ accepted: boolean; message: string }> {
    await this.connect();
    return new Promise((resolve) => {
      const existing = this.#pendingPublishes.get(event.id);
      if (existing) {
        globalThis.clearTimeout(existing.timer);
        existing.resolve({ accepted: false, message: "Superseded duplicate publish" });
      }
      const timer = globalThis.setTimeout(() => {
        this.#pendingPublishes.delete(event.id);
        resolve({ accepted: false, message: "Relay acknowledgement timed out" });
      }, maxWait);
      this.#pendingPublishes.set(event.id, { resolve, timer });
      this.#send(["EVENT", event]);
    });
  }

  close(): void {
    this.#closed = true;
    if (this.#reconnectTimer != null) globalThis.clearTimeout(this.#reconnectTimer);
    this.#socket?.close();
    this.#subscriptions.clear();
  }

  #send(message: unknown[]): void {
    if (!this.connected) return;
    this.#socket?.send(JSON.stringify(message));
  }

  #handleMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    let message: unknown;
    try {
      message = JSON.parse(raw) as unknown;
    } catch {
      return;
    }
    if (!Array.isArray(message) || typeof message[0] !== "string") return;
    const type = message[0];
    if (type === "EVENT") {
      const id = message[1];
      const event = message[2];
      if (typeof id === "string" && validateEventShape(event)) {
        this.#subscriptions.get(id)?.handlers.onevent({ event, relay: this.url });
      }
      return;
    }
    if (type === "EOSE") {
      const id = message[1];
      if (typeof id === "string") this.#subscriptions.get(id)?.handlers.oneose?.(this.url);
      return;
    }
    if (type === "NOTICE") {
      const notice = typeof message[1] === "string" ? message[1] : "Relay notice";
      for (const subscription of this.#subscriptions.values()) {
        subscription.handlers.onnotice?.(this.url, notice);
      }
      return;
    }
    if (type === "OK") {
      const eventId = message[1];
      const accepted = message[2];
      const detail = message[3];
      if (typeof eventId !== "string" || typeof accepted !== "boolean") return;
      const pending = this.#pendingPublishes.get(eventId);
      if (!pending) return;
      globalThis.clearTimeout(pending.timer);
      this.#pendingPublishes.delete(eventId);
      pending.resolve({ accepted, message: typeof detail === "string" ? detail : "" });
    }
  }

  #scheduleReconnect(): void {
    if (this.#reconnectTimer != null || this.#closed) return;
    const delay = Math.min(30_000, 1_000 * 2 ** this.#reconnectAttempt) + Math.floor(Math.random() * 500);
    this.#reconnectAttempt += 1;
    this.#reconnectTimer = globalThis.setTimeout(() => {
      this.#reconnectTimer = null;
      void this.connect().catch(() => this.#scheduleReconnect());
    }, delay);
  }
}

function randomId(prefix: string): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}-${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export class WebSocketNostrTransport implements NostrTransport {
  readonly #connections = new Map<string, RelayConnection>();
  readonly #listeners = new Set<(connected: string[]) => void>();

  #connection(url: string): RelayConnection {
    let connection = this.#connections.get(url);
    if (!connection) {
      connection = new RelayConnection(url, () => this.#notifyConnections());
      this.#connections.set(url, connection);
    }
    return connection;
  }

  async query(
    relays: readonly string[],
    filter: NostrFilter,
    options: { maxWait?: number } = {},
  ): Promise<RelayEvent[]> {
    const maxWait = options.maxWait ?? 4_000;
    const results: RelayEvent[] = [];
    const completed = new Set<string>();
    return new Promise((resolve) => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        globalThis.clearTimeout(timer);
        unsubscribe();
        resolve(results);
      };
      const unsubscribe = this.subscribe(relays, filter, {
        onevent: (event) => results.push(event),
        oneose: (relay) => {
          completed.add(relay);
          if (completed.size >= new Set(relays).size) finish();
        },
      });
      const timer = globalThis.setTimeout(finish, maxWait);
    });
  }

  subscribe(relays: readonly string[], filter: NostrFilter, handlers: SubscriptionHandlers): () => void {
    const baseId = randomId("sedd");
    const subscriptions = [...new Set(relays)].map((relay, index) => {
      const id = `${baseId}-${index}`;
      const connection = this.#connection(relay);
      connection.subscribe(id, filter, handlers);
      return { connection, id };
    });
    return () => {
      for (const { connection, id } of subscriptions) connection.unsubscribe(id);
    };
  }

  async publish(
    relays: readonly string[],
    event: NostrEvent,
    options: { maxWait?: number } = {},
  ): Promise<PublishResult> {
    const maxWait = options.maxWait ?? 4_000;
    const uniqueRelays = [...new Set(relays)];
    const acceptedBy: string[] = [];
    const rejectedBy: Array<{ relay: string; message: string }> = [];
    const attempts = uniqueRelays.map(async (relay) => {
      try {
        const result = await this.#connection(relay).publish(event, maxWait);
        if (result.accepted) {
          acceptedBy.push(relay);
          return relay;
        }
        rejectedBy.push({ relay, message: result.message });
        throw new Error(result.message || `${relay} rejected the event`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!rejectedBy.some((item) => item.relay === relay)) rejectedBy.push({ relay, message });
        throw error;
      }
    });
    try {
      await Promise.any(attempts);
      void Promise.allSettled(attempts);
      return { acceptedBy: [...acceptedBy], rejectedBy: [...rejectedBy] };
    } catch {
      await Promise.allSettled(attempts);
      throw new AggregateError(rejectedBy.map((item) => new Error(`${item.relay}: ${item.message}`)), "All relays rejected or timed out");
    }
  }

  connectedRelays(): string[] {
    return [...this.#connections.values()].filter((connection) => connection.connected).map((connection) => connection.url).sort();
  }

  onConnectionChange(listener: (connected: string[]) => void): () => void {
    this.#listeners.add(listener);
    listener(this.connectedRelays());
    return () => this.#listeners.delete(listener);
  }

  close(): void {
    for (const connection of this.#connections.values()) connection.close();
    this.#connections.clear();
    this.#notifyConnections();
  }

  #notifyConnections(): void {
    const connected = this.connectedRelays();
    for (const listener of this.#listeners) listener(connected);
  }
}

function matchesFilter(event: NostrEvent, filter: NostrFilter): boolean {
  if (filter.ids && !filter.ids.some((id) => event.id.startsWith(id))) return false;
  if (filter.authors && !filter.authors.some((author) => event.pubkey.startsWith(author))) return false;
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.since != null && event.created_at < filter.since) return false;
  if (filter.until != null && event.created_at > filter.until) return false;
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith("#") || !Array.isArray(values)) continue;
    const tagName = key.slice(1);
    if (!event.tags.some((tag) => tag[0] === tagName && values.includes(tag[1] as never))) return false;
  }
  return true;
}

export class InMemoryTestTransport implements NostrTransport {
  readonly #events = new Map<string, NostrEvent>();
  readonly #subscribers = new Map<string, { filter: NostrFilter; handlers: SubscriptionHandlers }>();
  readonly #relays: string[];

  constructor(relays = ["wss://memory.test"]) {
    this.#relays = relays;
  }

  async query(_relays: readonly string[], filter: NostrFilter): Promise<RelayEvent[]> {
    const values = [...this.#events.values()]
      .filter((event) => matchesFilter(event, filter))
      .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id));
    const limited = filter.limit == null ? values : values.slice(0, filter.limit);
    return limited.map((event) => ({ event, relay: this.#relays[0] ?? "wss://memory.test" }));
  }

  subscribe(_relays: readonly string[], filter: NostrFilter, handlers: SubscriptionHandlers): () => void {
    const id = randomId("memory");
    this.#subscribers.set(id, { filter, handlers });
    queueMicrotask(() => handlers.oneose?.(this.#relays[0] ?? "wss://memory.test"));
    return () => this.#subscribers.delete(id);
  }

  async publish(_relays: readonly string[], event: NostrEvent): Promise<PublishResult> {
    this.#events.set(event.id, event);
    for (const subscriber of this.#subscribers.values()) {
      if (matchesFilter(event, subscriber.filter)) {
        queueMicrotask(() => subscriber.handlers.onevent({ event, relay: this.#relays[0] ?? "wss://memory.test" }));
      }
    }
    return { acceptedBy: [this.#relays[0] ?? "wss://memory.test"], rejectedBy: [] };
  }

  connectedRelays(): string[] {
    return [...this.#relays];
  }

  onConnectionChange(listener: (connected: string[]) => void): () => void {
    listener(this.connectedRelays());
    return () => undefined;
  }

  close(): void {
    this.#subscribers.clear();
  }

  seed(events: NostrEvent[]): void {
    for (const event of events) this.#events.set(event.id, event);
  }

  events(): NostrEvent[] {
    return [...this.#events.values()];
  }
}
