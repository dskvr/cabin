import { APP_KIND, GIFT_WRAP_KIND, PRIVATE_PROPOSAL_KIND, PRIVATE_SCHEDULE_KIND, WEEK_ARCHIVE_KIND } from "../config/relays.js";
import type { PrivateProposal, PrivateSchedule, PublicSchedule, WeekArchive } from "../domain/cabin.js";
import { parsePrivateProposal, parsePrivateSchedule, parsePublicSchedule, parseWeekArchive, validateProposalForWeek } from "../domain/cabin.js";
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
import { isAssignedCaptain } from "../domain/authorization.js";
import { weekAddress, weekD, type ProvisionedWeek } from "../domain/cohort.js";
import { MAX_WEEK_CONFIGURATION_CONTENT_LENGTH, parseWeekConfiguration, type WeekConfigurationV1 } from "../domain/week.js";
import { verifyEvent } from "./crypto.js";
import { localSigner, type EventSigner } from "./signer.js";

const MAX_PRIVATE_ENVELOPE_LENGTH = 65_536;

function singleTag(event: NostrEvent, name: string): string | null {
  const tags = event.tags.filter((tag) => tag.length === 2 && tag[0] === name);
  return tags.length === 1 ? tags[0]?.[1] ?? null : null;
}

async function unwrapGift(event: NostrEvent, signer: EventSigner): Promise<NostrEvent | null> {
  if (event.kind !== GIFT_WRAP_KIND || event.content.length > MAX_PRIVATE_ENVELOPE_LENGTH || singleTag(event, "p") !== signer.publicKey || !(await verifyEvent(event))) return null;
  try {
    const plaintext = await signer.decryptNip44(event.pubkey, event.content);
    if (plaintext.length > MAX_PRIVATE_ENVELOPE_LENGTH) return null;
    const inner = JSON.parse(plaintext) as unknown;
    return typeof inner === "object" && inner !== null && await verifyEvent(inner as NostrEvent) ? inner as NostrEvent : null;
  } catch {
    return null;
  }
}

export async function parsePrivateProposalGift({
  event, recipientSecretKeyHex, slot, configuration, configurationEventId,
}: { event: NostrEvent; recipientSecretKeyHex: string; slot: ProvisionedWeek; configuration: WeekConfigurationV1; configurationEventId: string }): Promise<{ event: NostrEvent; inner: NostrEvent; proposal: PrivateProposal } | null> {
  return parsePrivateProposalGiftWithSigner({ event, signer: localSigner(recipientSecretKeyHex), slot, configuration, configurationEventId });
}

export async function parsePrivateProposalGiftWithSigner({
  event, signer, slot, configuration, configurationEventId,
}: { event: NostrEvent; signer: EventSigner; slot: ProvisionedWeek; configuration: WeekConfigurationV1; configurationEventId: string }): Promise<{ event: NostrEvent; inner: NostrEvent; proposal: PrivateProposal } | null> {
  const inner = await unwrapGift(event, signer);
  if (!inner || inner.kind !== PRIVATE_PROPOSAL_KIND || singleTag(inner, "t") !== "captains-cabin-private-proposal" || inner.content.length > MAX_WEEK_CONFIGURATION_CONTENT_LENGTH) return null;
  const proposal = parsePrivateProposal(safeJson(inner.content));
  if (!proposal || validateProposalForWeek(proposal, inner.pubkey, slot, configuration, configurationEventId).length) return null;
  return { event, inner, proposal };
}

export async function parsePrivateScheduleGift(event: NostrEvent, recipientSecretKeyHex: string, slot: ProvisionedWeek): Promise<{ event: NostrEvent; inner: NostrEvent; schedule: PrivateSchedule } | null> {
  return parsePrivateScheduleGiftWithSigner(event, localSigner(recipientSecretKeyHex), slot);
}

export async function parsePrivateScheduleGiftWithSigner(event: NostrEvent, signer: EventSigner, slot: ProvisionedWeek): Promise<{ event: NostrEvent; inner: NostrEvent; schedule: PrivateSchedule } | null> {
  const inner = await unwrapGift(event, signer);
  if (!inner || inner.kind !== PRIVATE_SCHEDULE_KIND || inner.pubkey !== slot.captain_pubkey || singleTag(inner, "t") !== "captains-cabin-private-schedule" || inner.content.length > MAX_WEEK_CONFIGURATION_CONTENT_LENGTH) return null;
  const schedule = parsePrivateSchedule(safeJson(inner.content));
  return schedule && schedule.cohort_id === slot.cohort_id && schedule.week_number === slot.week_number ? { event, inner, schedule } : null;
}

export function parsePublicScheduleEvent(event: NostrEvent, slot: ProvisionedWeek): PublicSchedule | null {
  if (event.kind !== APP_KIND || event.pubkey !== slot.captain_pubkey || singleTag(event, "d") !== `captains-cabin:schedule:${slot.cohort_id}:${slot.week_number}` || singleTag(event, "t") !== "captains-cabin-public-schedule" || event.content.length > MAX_WEEK_CONFIGURATION_CONTENT_LENGTH) return null;
  const value = parsePublicSchedule(safeJson(event.content));
  return value && value.cohort_id === slot.cohort_id && value.week_number === slot.week_number ? value : null;
}

export function parseWeekArchiveEvent(event: NostrEvent, slot: ProvisionedWeek): WeekArchive | null {
  if (event.kind !== WEEK_ARCHIVE_KIND || event.pubkey !== slot.captain_pubkey || singleTag(event, "d") !== `captains-cabin:archive:${slot.cohort_id}:${slot.week_number}` || singleTag(event, "t") !== "captains-cabin-week-archive" || event.content.length > MAX_WEEK_CONFIGURATION_CONTENT_LENGTH) return null;
  const value = parseWeekArchive(safeJson(event.content));
  return value && value.cohort_id === slot.cohort_id && value.week_number === slot.week_number ? value : null;
}

export interface ParsedWeekConfiguration {
  event: NostrEvent;
  configuration: WeekConfigurationV1;
  d: string;
  address: string;
}

export function parseWeekConfigurationEvent(event: NostrEvent, slot: ProvisionedWeek): ParsedWeekConfiguration | null {
  if (event.kind !== APP_KIND || !isAssignedCaptain(slot, event.pubkey)) return null;
  const d = exactTag(event, "d");
  if (d !== weekD(slot) || exactTag(event, "t") !== "captains-cabin-week") return null;
  if (event.content.length > MAX_WEEK_CONFIGURATION_CONTENT_LENGTH) return null;
  const configuration = parseWeekConfiguration(safeJson(event.content));
  if (!configuration || configuration.cohort_id !== slot.cohort_id || configuration.week_number !== slot.week_number) return null;
  return { event, configuration, d, address: weekAddress(slot) };
}

/** Require a single canonical coordinate/application tag; duplicate tags are ambiguous. */
function exactTag(event: NostrEvent, name: string): string | null {
  const matching = event.tags.filter((tag) => tag.length === 2 && tag[0] === name);
  return matching.length === 1 && typeof matching[0]?.[1] === "string" ? matching[0][1] : null;
}

function safeJson(content: string): unknown {
  try { return JSON.parse(content) as unknown; } catch { return null; }
}

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
  const hasWeekContext = "cohort_id" in value || "week_number" in value || "week_configuration_event_id" in value;
  if (hasWeekContext && (
    typeof value.cohort_id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.cohort_id) ||
    typeof value.week_number !== "number" || !Number.isInteger(value.week_number) || value.week_number < 1 ||
    !isValidEventId(value.week_configuration_event_id)
  )) return null;
  if (!isSafeMs(value.created_at_ms) || !isSafeMs(value.closed_at_ms, true)) return null;
  if (!(value.current_demo_pubkey === null || isValidHexPubkey(value.current_demo_pubkey))) return null;
  if (!isSafeMs(value.timer_started_at_ms, true)) return null;
  const hasTimingSnapshot = "presentation_minutes" in value || "question_minutes" in value;
  if (hasTimingSnapshot && (
    typeof value.presentation_minutes !== "number" || !Number.isInteger(value.presentation_minutes) || value.presentation_minutes < 1 || value.presentation_minutes > 180 ||
    typeof value.question_minutes !== "number" || !Number.isInteger(value.question_minutes) || value.question_minutes < 1 || value.question_minutes > 180
  )) return null;
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
  const feedbackEntries: ParticipantEntryV1["feedback"] = {};
  for (const [pubkey, feedback] of Object.entries(value.feedback)) {
    if (!isValidHexPubkey(pubkey) || !isRecord(feedback)) return null;
    if (typeof feedback.liked !== "string") return null;
    feedbackEntries[pubkey] = { liked: feedback.liked };
  }
  if (!isSafeMs(value.updated_at_ms)) return null;
  return { ...value, feedback: feedbackEntries } as unknown as ParticipantEntryV1;
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
