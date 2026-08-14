import { isRecord, isValidHexPubkey } from "./utils.js";
import { decodeNpub } from "../nostr/bech32.js";

const MAX_PEOPLE = 512;

export interface CohortManifestV1 {
  v: 1;
  cohort_id: string;
  start_date: string;
  end_date: string;
  starting_week: number;
  captains: ReadonlyArray<{ week_number: number; pubkey: string }>;
  participant_allowlist: readonly string[];
}

export interface ProvisionedWeek {
  cohort_id: string;
  week_number: number;
  start_date: string;
  end_date: string;
  timezone: "Atlantic/Madeira";
  captain_pubkey: string;
  participant_allowlist: readonly string[];
}

function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year == null || month == null || day == null) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateAt(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

function dateAfter(value: string, days: number): string {
  return new Date(dateAt(value) + days * 86_400_000).toISOString().slice(0, 10);
}

function parseNpub(value: unknown): string | null {
  if (typeof value !== "string" || value.toLowerCase().startsWith("nsec1")) return null;
  try {
    const pubkey = decodeNpub(value).toLowerCase();
    return isValidHexPubkey(pubkey) ? pubkey : null;
  } catch {
    return null;
  }
}

export function parseCohortManifest(value: unknown): CohortManifestV1 | null {
  if (!isRecord(value) || value.v !== 1 || typeof value.cohort_id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.cohort_id)) return null;
  if (!calendarDate(value.start_date) || !calendarDate(value.end_date) || dateAt(value.end_date) < dateAt(value.start_date)) return null;
  const startingWeek = value.starting_week === undefined ? 1 : value.starting_week;
  if (!Number.isInteger(startingWeek) || startingWeek < 1 || !Array.isArray(value.captains) || !Array.isArray(value.participant_allowlist)) return null;
  if (value.captains.length > MAX_PEOPLE || value.participant_allowlist.length > MAX_PEOPLE) return null;
  const captainWeeks = new Set<number>();
  const captainPubkeys = new Set<string>();
  const captains: Array<{ week_number: number; pubkey: string }> = [];
  for (const item of value.captains) {
    if (!isRecord(item) || !Number.isInteger(item.week_number) || item.week_number < startingWeek) return null;
    const pubkey = parseNpub(item.npub);
    if (!pubkey || captainWeeks.has(item.week_number) || captainPubkeys.has(pubkey)) return null;
    captainWeeks.add(item.week_number);
    captainPubkeys.add(pubkey);
    captains.push({ week_number: item.week_number, pubkey });
  }
  const allowlist = value.participant_allowlist.map(parseNpub);
  if (allowlist.some((pubkey): pubkey is null => pubkey === null)) return null;
  const participant_allowlist = allowlist as string[];
  if (new Set(participant_allowlist).size !== participant_allowlist.length) return null;
  const totalSlots = Math.floor((dateAt(value.end_date) - dateAt(value.start_date) + 86_400_000) / (7 * 86_400_000));
  if (captains.some((captain) => captain.week_number > totalSlots)) return null;
  return { v: 1, cohort_id: value.cohort_id, start_date: value.start_date, end_date: value.end_date, starting_week: startingWeek, captains, participant_allowlist };
}

export function weekD(slot: Pick<ProvisionedWeek, "cohort_id" | "week_number">): string {
  return `captains-cabin:week:${slot.cohort_id}:${slot.week_number}`;
}

export function weekAddress(slot: Pick<ProvisionedWeek, "captain_pubkey" | "cohort_id" | "week_number">): string {
  return `30078:${slot.captain_pubkey}:${weekD(slot)}`;
}

export function deriveProvisionedWeeks(manifest: CohortManifestV1): ProvisionedWeek[] {
  return manifest.captains.map((captain) => {
    const offset = (captain.week_number - 1) * 7;
    return {
      cohort_id: manifest.cohort_id,
      week_number: captain.week_number,
      start_date: dateAfter(manifest.start_date, offset),
      end_date: dateAfter(manifest.start_date, offset + 6),
      timezone: "Atlantic/Madeira",
      captain_pubkey: captain.pubkey,
      participant_allowlist: manifest.participant_allowlist,
    };
  }).sort((left, right) => left.week_number - right.week_number);
}

export function weekForCaptain(manifest: CohortManifestV1, pubkey: string): ProvisionedWeek | null {
  return deriveProvisionedWeeks(manifest).find((slot) => slot.captain_pubkey === pubkey.toLowerCase()) ?? null;
}
