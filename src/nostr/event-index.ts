import type { NostrEvent } from "../domain/types.js";
import { compareReplaceable, getTag } from "../domain/utils.js";

export function isReplaceableKind(kind: number): boolean {
  return kind === 0 || kind === 3 || (kind >= 10_000 && kind < 20_000) || (kind >= 30_000 && kind < 40_000);
}

export function eventCoordinate(event: NostrEvent): string {
  if (event.kind >= 30_000 && event.kind < 40_000) {
    return `${event.kind}:${event.pubkey}:${getTag(event, "d") ?? ""}`;
  }
  if (isReplaceableKind(event.kind)) return `${event.kind}:${event.pubkey}`;
  return `id:${event.id}`;
}

export class EventIndex {
  readonly #events = new Map<string, NostrEvent>();
  readonly #ids = new Map<string, NostrEvent>();

  ingest(event: NostrEvent): boolean {
    if (this.#ids.has(event.id)) return false;
    this.#ids.set(event.id, event);
    const coordinate = eventCoordinate(event);
    const current = this.#events.get(coordinate);
    if (isReplaceableKind(event.kind)) {
      if (!compareReplaceable(event, current)) return false;
    } else if (current) {
      return false;
    }
    this.#events.set(coordinate, event);
    return true;
  }

  get(coordinate: string): NostrEvent | undefined {
    return this.#events.get(coordinate);
  }

  getById(id: string): NostrEvent | undefined {
    return this.#ids.get(id);
  }

  values(): NostrEvent[] {
    return [...this.#events.values()];
  }

  allEvents(): NostrEvent[] {
    return [...this.#ids.values()];
  }

  remove(id: string): void {
    const event = this.#ids.get(id);
    if (!event) return;
    this.#ids.delete(id);
    const coordinate = eventCoordinate(event);
    if (this.#events.get(coordinate)?.id === id) this.#events.delete(coordinate);
  }

  clear(): void {
    this.#events.clear();
    this.#ids.clear();
  }
}
