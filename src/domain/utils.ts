import type { NostrEvent, NostrTag } from "./types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isHex(value: unknown, length: number): value is string {
  return typeof value === "string" && new RegExp(`^[0-9a-f]{${length}}$`).test(value);
}

export function isValidHexPubkey(value: unknown): value is string {
  return isHex(value, 64);
}

export function isValidEventId(value: unknown): value is string {
  return isHex(value, 64);
}

export function getTag(event: Pick<NostrEvent, "tags">, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

export function getTags(event: Pick<NostrEvent, "tags">, name: string): NostrTag[] {
  return event.tags.filter((tag) => tag[0] === name);
}

export function hasTag(event: Pick<NostrEvent, "tags">, name: string, value: string): boolean {
  return event.tags.some((tag) => tag[0] === name && tag[1] === value);
}

export function dedupe<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

export function nextCreatedAt(previousCreatedAt?: number): number {
  const now = Math.floor(Date.now() / 1000);
  return previousCreatedAt == null ? now : Math.max(now, previousCreatedAt + 1);
}

export function clampText(value: string, max: number): string {
  return value.trim().slice(0, max);
}

export function normalizeOptionalUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.href;
  } catch {
    return null;
  }
}

export function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function formatDateTime(ms: number | null): string {
  return ms == null ? "—" : new Date(ms).toLocaleString();
}

export function shorten(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function cloneTags(tags: NostrTag[]): NostrTag[] {
  return tags.map((tag) => [...tag]);
}

export function compareReplaceable(candidate: NostrEvent, current: NostrEvent | undefined): boolean {
  if (!current) return true;
  if (candidate.created_at !== current.created_at) return candidate.created_at > current.created_at;
  return candidate.id < current.id;
}

export function sessionAddress(captainPubkey: string, sessionD: string): string {
  return `30078:${captainPubkey}:${sessionD}`;
}

export function entryD(sessionD: string): string {
  return `sedd-entry:${sessionD}`;
}

export function entryAddress(authorPubkey: string, sessionD: string): string {
  return `30078:${authorPubkey}:${entryD(sessionD)}`;
}

export function validRelayUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "wss:") return null;
    url.hash = "";
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}
