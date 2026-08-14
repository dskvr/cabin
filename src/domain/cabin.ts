import type { ProvisionedWeek } from "./cohort.js";
import { parseWeekConfiguration, type ProposalFieldV1, type WeekActivityV1, type WeekConfigurationV1 } from "./week.js";
import { isRecord, isValidEventId, isValidHexPubkey } from "./utils.js";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_ANSWER_LENGTH = 4_000;
const MAX_PROPOSALS = 512;
const MAX_PLACEMENTS = 512;

export interface PrivateProposal {
  v: 1;
  type: "captains-cabin-proposal";
  proposal_id: string;
  cohort_id: string;
  week_number: number;
  configuration_event_id: string;
  author_pubkey: string;
  answers: Record<string, string>;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface ProposalDecision {
  proposal_id: string;
  decision: "pending" | "accepted" | "rejected";
}

export interface SchedulePlacement {
  id: string;
  proposal_id: string;
  activity_id: string;
  starts_at: string;
  ends_at: string;
  public_title: string;
  public_presenter: string;
  public_description: string;
}

export interface PrivateSchedule {
  v: 1;
  type: "captains-cabin-private-schedule";
  draft_id: string;
  cohort_id: string;
  week_number: number;
  configuration_event_id: string;
  base_event_id: string | null;
  decisions: ProposalDecision[];
  placements: SchedulePlacement[];
  updated_at_ms: number;
}

export interface PublicSchedule {
  v: 1;
  type: "captains-cabin-public-schedule";
  publication_id: string;
  cohort_id: string;
  week_number: number;
  timezone: "Atlantic/Madeira";
  source_configuration_event_id: string;
  source_draft_event_id: string;
  published_at_ms: number;
  activities: Array<{
    id: string;
    day: WeekActivityV1["day"];
    name: string;
    date: string;
    starts_at: string;
    ends_at: string;
    location: string;
    link: string | null;
    sessions: Array<{
      id: string;
      starts_at: string;
      ends_at: string;
      title: string;
      presenter: string;
      description: string;
    }>;
  }>;
}

export interface WeekArchive {
  v: 1;
  type: "captains-cabin-week-archive";
  archive_id: string;
  cohort_id: string;
  week_number: number;
  configuration_event_id: string;
  public_schedule_event_id: string | null;
  completed_at_ms: number;
  configuration: Omit<WeekConfigurationV1, "base_event_id" | "status" | "intake_open">;
  public_schedule: PublicSchedule | null;
}

function time(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function boundedText(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= maximum && (allowEmpty || value.trim().length > 0);
}

function safeMs(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isWhitelistedParticipant(slot: ProvisionedWeek, pubkey: string): boolean {
  return isValidHexPubkey(pubkey) && slot.participant_allowlist.includes(pubkey.toLowerCase());
}

export function proposalIdFor(slot: Pick<ProvisionedWeek, "week_number">, authorPubkey: string): string {
  if (!isValidHexPubkey(authorPubkey)) throw new Error("Invalid proposal author");
  return `proposal-${slot.week_number}-${authorPubkey.slice(0, 16)}`;
}

export function parsePrivateProposal(value: unknown): PrivateProposal | null {
  if (!isRecord(value) || Object.keys(value).some((key) => ![
    "v", "type", "proposal_id", "cohort_id", "week_number", "configuration_event_id",
    "author_pubkey", "answers", "created_at_ms", "updated_at_ms",
  ].includes(key))) return null;
  if (value.v !== 1 || value.type !== "captains-cabin-proposal" || typeof value.proposal_id !== "string" || !ID.test(value.proposal_id)) return null;
  if (typeof value.cohort_id !== "string" || !ID.test(value.cohort_id) || typeof value.week_number !== "number" || !Number.isInteger(value.week_number) || value.week_number < 1) return null;
  if (!isValidEventId(value.configuration_event_id) || !isValidHexPubkey(value.author_pubkey) || !isRecord(value.answers)) return null;
  if (!safeMs(value.created_at_ms) || !safeMs(value.updated_at_ms) || value.updated_at_ms < value.created_at_ms) return null;
  const entries = Object.entries(value.answers);
  if (entries.length > 32 || entries.some(([id, answer]) => !ID.test(id) || !boundedText(answer, MAX_ANSWER_LENGTH, true))) return null;
  return value as unknown as PrivateProposal;
}

export function validateProposalForWeek(
  proposal: PrivateProposal,
  authorPubkey: string,
  slot: ProvisionedWeek,
  configuration: WeekConfigurationV1,
  configurationEventId: string,
): string[] {
  const errors: string[] = [];
  if (proposal.author_pubkey !== authorPubkey) errors.push("Proposal author does not match its signature.");
  if (proposal.proposal_id !== proposalIdFor(slot, authorPubkey)) errors.push("Proposal identifier does not belong to its author.");
  if (!isWhitelistedParticipant(slot, authorPubkey)) errors.push("Participant is not whitelisted.");
  if (proposal.cohort_id !== slot.cohort_id || proposal.week_number !== slot.week_number) errors.push("Proposal targets the wrong week.");
  if (proposal.configuration_event_id !== configurationEventId) errors.push("Proposal uses a stale week configuration.");
  if (!configuration.intake_open || configuration.status !== "active") errors.push("Proposal intake is closed.");
  const fields = new Map(configuration.proposal_fields.map((field) => [field.id, field]));
  if (Object.keys(proposal.answers).some((id) => !fields.has(id))) errors.push("Proposal contains an unknown form field.");
  for (const field of fields.values()) if (field.required && !proposal.answers[field.id]?.trim()) errors.push(`${field.label} is required.`);
  return errors;
}

export function parsePrivateSchedule(value: unknown): PrivateSchedule | null {
  if (!isRecord(value) || value.v !== 1 || value.type !== "captains-cabin-private-schedule" || typeof value.draft_id !== "string" || !ID.test(value.draft_id)) return null;
  if (typeof value.cohort_id !== "string" || !ID.test(value.cohort_id) || typeof value.week_number !== "number" || !Number.isInteger(value.week_number) || !isValidEventId(value.configuration_event_id)) return null;
  if (!(value.base_event_id === null || isValidEventId(value.base_event_id)) || !safeMs(value.updated_at_ms)) return null;
  if (!Array.isArray(value.decisions) || value.decisions.length > MAX_PROPOSALS || !value.decisions.every((item) => isRecord(item) && typeof item.proposal_id === "string" && ID.test(item.proposal_id) && ["pending", "accepted", "rejected"].includes(String(item.decision)))) return null;
  if (!Array.isArray(value.placements) || value.placements.length > MAX_PLACEMENTS || !value.placements.every((item) => isRecord(item) && typeof item.id === "string" && ID.test(item.id) && typeof item.proposal_id === "string" && ID.test(item.proposal_id) && typeof item.activity_id === "string" && ID.test(item.activity_id) && time(item.starts_at) && time(item.ends_at) && item.starts_at < item.ends_at && boundedText(item.public_title, 200) && boundedText(item.public_presenter, 160) && boundedText(item.public_description, 1_000, true))) return null;
  const schedule = value as unknown as PrivateSchedule;
  if (new Set(schedule.decisions.map((item) => item.proposal_id)).size !== schedule.decisions.length || new Set(schedule.placements.map((item) => item.id)).size !== schedule.placements.length) return null;
  return schedule;
}

export function scheduleWarnings(schedule: PrivateSchedule, configuration: WeekConfigurationV1): string[] {
  const warnings: string[] = [];
  const activities = new Map(configuration.activities.map((activity) => [activity.id, activity]));
  const accepted = new Set(schedule.decisions.filter((item) => item.decision === "accepted").map((item) => item.proposal_id));
  const counts = new Map<string, number>();
  for (const placement of schedule.placements) {
    counts.set(placement.proposal_id, (counts.get(placement.proposal_id) ?? 0) + 1);
    const activity = activities.get(placement.activity_id);
    if (!accepted.has(placement.proposal_id)) warnings.push(`${placement.id} uses a proposal that is not accepted.`);
    if (!activity) warnings.push(`${placement.id} uses an unknown activity.`);
    else if (placement.starts_at < activity.starts_at || placement.ends_at > activity.ends_at) warnings.push(`${placement.id} falls outside ${activity.name}.`);
  }
  for (const [proposalId, count] of counts) if (count > 1) warnings.push(`${proposalId} is placed more than once.`);
  for (const activity of configuration.activities) {
    const placements = schedule.placements.filter((item) => item.activity_id === activity.id).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    for (let index = 1; index < placements.length; index += 1) if (placements[index]!.starts_at < placements[index - 1]!.ends_at) warnings.push(`${placements[index - 1]!.id} overlaps ${placements[index]!.id}.`);
  }
  return warnings;
}

export function publicScheduleProjection(
  schedule: PrivateSchedule,
  configuration: WeekConfigurationV1,
  sourceDraftEventId: string,
  publicationId: string,
  publishedAtMs: number,
): PublicSchedule {
  if (!ID.test(publicationId) || !isValidEventId(sourceDraftEventId)) throw new Error("Invalid publication coordinates");
  const accepted = new Set(schedule.decisions.filter((item) => item.decision === "accepted").map((item) => item.proposal_id));
  return {
    v: 1, type: "captains-cabin-public-schedule", publication_id: publicationId,
    cohort_id: configuration.cohort_id, week_number: configuration.week_number, timezone: configuration.timezone,
    source_configuration_event_id: schedule.configuration_event_id, source_draft_event_id: sourceDraftEventId, published_at_ms: publishedAtMs,
    activities: configuration.activities.map(({ id, day, name, date, starts_at, ends_at, location, link }) => ({
      id, day, name, date, starts_at, ends_at, location, link,
      sessions: schedule.placements.filter((item) => item.activity_id === id && accepted.has(item.proposal_id)).map((item) => ({
        id: item.id, starts_at: item.starts_at, ends_at: item.ends_at, title: item.public_title,
        presenter: item.public_presenter, description: item.public_description,
      })),
    })),
  };
}

export function parsePublicSchedule(value: unknown): PublicSchedule | null {
  const topKeys = ["v", "type", "publication_id", "cohort_id", "week_number", "timezone", "source_configuration_event_id", "source_draft_event_id", "published_at_ms", "activities"];
  if (!isRecord(value) || Object.keys(value).some((key) => !topKeys.includes(key)) || value.v !== 1 || value.type !== "captains-cabin-public-schedule" || typeof value.publication_id !== "string" || !ID.test(value.publication_id) || typeof value.cohort_id !== "string" || !ID.test(value.cohort_id) || typeof value.week_number !== "number" || !Number.isInteger(value.week_number) || value.week_number < 1 || value.timezone !== "Atlantic/Madeira" || !isValidEventId(value.source_configuration_event_id) || !isValidEventId(value.source_draft_event_id) || !safeMs(value.published_at_ms) || !Array.isArray(value.activities) || value.activities.length > 64) return null;
  const activityKeys = ["id", "day", "name", "date", "starts_at", "ends_at", "location", "link", "sessions"];
  const sessionKeys = ["id", "starts_at", "ends_at", "title", "presenter", "description"];
  if (!value.activities.every((activity) => isRecord(activity) && !Object.keys(activity).some((key) => !activityKeys.includes(key)) && typeof activity.id === "string" && ID.test(activity.id) && (activity.day === "tuesday" || activity.day === "wednesday") && boundedText(activity.name, 160) && typeof activity.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(activity.date) && time(activity.starts_at) && time(activity.ends_at) && activity.starts_at < activity.ends_at && boundedText(activity.location, 240) && (activity.link === null || typeof activity.link === "string" && /^https?:\/\//.test(activity.link)) && Array.isArray(activity.sessions) && activity.sessions.length <= MAX_PLACEMENTS && activity.sessions.every((session) => isRecord(session) && !Object.keys(session).some((key) => !sessionKeys.includes(key)) && typeof session.id === "string" && ID.test(session.id) && time(session.starts_at) && time(session.ends_at) && session.starts_at < session.ends_at && boundedText(session.title, 200) && boundedText(session.presenter, 160) && boundedText(session.description, 1_000, true)))) return null;
  const schedule = value as unknown as PublicSchedule;
  const activityIds = schedule.activities.map((item) => item.id);
  const sessionIds = schedule.activities.flatMap((item) => item.sessions.map((session) => session.id));
  if (new Set(activityIds).size !== activityIds.length || new Set(sessionIds).size !== sessionIds.length) return null;
  return schedule;
}

export function parseWeekArchive(value: unknown): WeekArchive | null {
  const keys = ["v", "type", "archive_id", "cohort_id", "week_number", "configuration_event_id", "public_schedule_event_id", "completed_at_ms", "configuration", "public_schedule"];
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key)) || value.v !== 1 || value.type !== "captains-cabin-week-archive" || typeof value.archive_id !== "string" || !ID.test(value.archive_id) || typeof value.cohort_id !== "string" || !ID.test(value.cohort_id) || typeof value.week_number !== "number" || !Number.isInteger(value.week_number) || value.week_number < 1 || !isValidEventId(value.configuration_event_id) || !(value.public_schedule_event_id === null || isValidEventId(value.public_schedule_event_id)) || !safeMs(value.completed_at_ms) || !isRecord(value.configuration)) return null;
  const configuration = parseWeekConfiguration({ ...value.configuration, status: "completed", intake_open: false, base_event_id: null });
  const publicSchedule = value.public_schedule === null ? null : parsePublicSchedule(value.public_schedule);
  if (!configuration || configuration.cohort_id !== value.cohort_id || configuration.week_number !== value.week_number || value.public_schedule !== null && !publicSchedule) return null;
  return value as unknown as WeekArchive;
}

export function cloneWeekConfiguration(
  source: WeekConfigurationV1,
  target: ProvisionedWeek,
  freshId: () => string,
): WeekConfigurationV1 {
  const makeId = (prefix: string): string => `${prefix}-${freshId()}`.slice(0, 64).replace(/[^a-z0-9-]/g, "-");
  return {
    v: 1, type: "week-configuration", cohort_id: target.cohort_id, week_number: target.week_number,
    timezone: "Atlantic/Madeira", status: "setup", intake_open: false,
    theme: source.theme, public_description: source.public_description,
    activities: source.activities.map((activity) => ({ ...activity, id: makeId(`w${target.week_number}-activity`), date: activity.day === "tuesday" ? target.start_date : target.end_date })),
    proposal_fields: source.proposal_fields.map((field) => ({ ...field, id: makeId(`w${target.week_number}-field`) })),
    presentation_minutes: source.presentation_minutes, question_minutes: source.question_minutes, base_event_id: null,
  };
}

export function configurationForArchive(configuration: WeekConfigurationV1): WeekArchive["configuration"] {
  const { base_event_id: _base, status: _status, intake_open: _intake, ...copy } = structuredClone(configuration);
  return copy;
}

export function proposalFieldAnswers(schema: ProposalFieldV1[], answers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(schema.map((field) => [field.id, answers[field.id] ?? ""]));
}
