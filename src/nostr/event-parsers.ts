import { APP_KIND } from "../config/relays.js";
import type {
  DemoDaySessionV1,
  NostrEvent,
  ParsedEntry,
  ParsedSession,
  ParticipantEntryV1,
} from "../domain/types.js";
import {
  entryAddress,
  getTag,
  hasTag,
  isRecord,
  isValidEventId,
  isValidHexPubkey,
  sessionAddress,
} from "../domain/utils.js";

function isSafeMs(value: unknown, nullable = false): value is number | null {
  return (nullable && value === null) || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

function isStringArray(value: unknown, validator: (value: unknown) => value is string = (item): item is string => typeof item === "string"): value is string[] {
  return Array.isArray(value) && value.every(validator);
}

function parseSessionContent(content: string): DemoDaySessionV1 | null {
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value) || value.v !== 1 || value.type !== "session") return null;
  if (typeof value.name !== "string" || value.name.trim().length === 0) return null;
  if (!isSafeMs(value.created_at_ms) || !isSafeMs(value.closed_at_ms, true)) return null;
  if (!(value.current_demo_pubkey === null || isValidHexPubkey(value.current_demo_pubkey))) return null;
  if (!isSafeMs(value.timer_started_at_ms, true)) return null;
  if (!Array.isArray(value.presented) || !value.presented.every((item) => {
    if (!isRecord(item) || !isValidHexPubkey(item.pubkey)) return false;
    if (typeof item.started_at_ms !== "number" || !Number.isSafeInteger(item.started_at_ms) || item.started_at_ms < 0) return false;
    if (typeof item.finished_at_ms !== "number" || !Number.isSafeInteger(item.finished_at_ms) || item.finished_at_ms < 0) return false;
    return item.finished_at_ms >= item.started_at_ms;
  })) return null;
  if (!(value.final_elo === null || (Array.isArray(value.final_elo) && value.final_elo.every((item) =>
    isRecord(item) && typeof item.rank === "number" && Number.isInteger(item.rank) && item.rank > 0 &&
    isValidHexPubkey(item.pubkey) && typeof item.rating === "number" && Number.isFinite(item.rating)
  )))) return null;
  for (const key of ["snapshot_entry_ids", "snapshot_profile_ids", "snapshot_zap_ids"] as const) {
    const item = value[key];
    if (!(item === null || isStringArray(item, isValidEventId))) return null;
  }
  return value as unknown as DemoDaySessionV1;
}

export function parseSessionEvent(event: NostrEvent): ParsedSession | null {
  if (event.kind !== APP_KIND || !hasTag(event, "t", "sedd-session")) return null;
  const d = getTag(event, "d");
  if (!d || !/^sedd-session:[0-9a-f]{32}$/.test(d)) return null;
  const state = parseSessionContent(event.content);
  if (!state) return null;
  return {
    event,
    state,
    d,
    address: sessionAddress(event.pubkey, d),
  };
}

function parseEntryContent(content: string): ParticipantEntryV1 | null {
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value) || value.v !== 1 || value.type !== "entry") return null;
  if (!isValidHexPubkey(value.real_pubkey) || !isValidEventId(value.source_profile_event_id)) return null;
  if (typeof value.source_profile_relay !== "string" || value.source_profile_relay.length === 0) return null;
  if (!isRecord(value.demo) || typeof value.demo.name !== "string" || !value.demo.name.trim()) return null;
  if (typeof value.demo.description !== "string" || !value.demo.description.trim()) return null;
  if (!(value.demo.link === null || typeof value.demo.link === "string")) return null;
  if (!isStringArray(value.ranking, isValidHexPubkey)) return null;
  if (new Set(value.ranking).size !== value.ranking.length) return null;
  if (!isRecord(value.feedback)) return null;
  for (const [pubkey, feedback] of Object.entries(value.feedback)) {
    if (!isValidHexPubkey(pubkey) || !isRecord(feedback)) return null;
    if (typeof feedback.liked !== "string" || typeof feedback.learned !== "string") return null;
  }
  if (!isSafeMs(value.updated_at_ms)) return null;
  return value as unknown as ParticipantEntryV1;
}

export function parseParticipantEntryEvent(event: NostrEvent, selectedSessionAddress?: string): ParsedEntry | null {
  if (event.kind !== APP_KIND || !hasTag(event, "t", "sedd-entry")) return null;
  const d = getTag(event, "d");
  const address = getTag(event, "a");
  if (!d || !d.startsWith("sedd-entry:sedd-session:") || !address) return null;
  if (selectedSessionAddress && address !== selectedSessionAddress) return null;
  const sessionD = address.split(":").slice(2).join(":");
  if (!/^sedd-session:[0-9a-f]{32}$/.test(sessionD)) return null;
  if (d !== `sedd-entry:${sessionD}`) return null;
  const content = parseEntryContent(event.content);
  if (!content) return null;
  return {
    event,
    content,
    author: event.pubkey,
    d,
    sessionAddress: address,
    address: entryAddress(event.pubkey, sessionD),
  };
}
