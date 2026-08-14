import type { ProvisionedWeek } from "./cohort.js";
import { isRecord, isValidEventId, normalizeOptionalUrl } from "./utils.js";

const MAX_ACTIVITIES = 64;
const MAX_PROPOSAL_FIELDS = 32;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_WEEK_CONFIGURATION_CONTENT_LENGTH = 32_768;
const CONFIGURATION_KEYS = new Set([
  "v", "type", "cohort_id", "week_number", "timezone", "status", "intake_open", "theme",
  "public_description", "activities", "proposal_fields", "presentation_minutes", "question_minutes", "base_event_id",
]);

export interface WeekActivityV1 {
  id: string;
  day: "tuesday" | "wednesday";
  name: string;
  date: string;
  starts_at: string;
  ends_at: string;
  location: string;
  link: string | null;
}

export interface ProposalFieldV1 { id: string; label: string; required: boolean; }

export interface WeekConfigurationV1 {
  v: 1;
  type: "week-configuration";
  cohort_id: string;
  week_number: number;
  timezone: "Atlantic/Madeira";
  status: "setup" | "active" | "completed";
  intake_open: boolean;
  theme: string;
  public_description: string;
  activities: WeekActivityV1[];
  proposal_fields: ProposalFieldV1[];
  presentation_minutes: number;
  question_minutes: number;
  base_event_id: string | null;
}

export interface PublicWeekProjection {
  theme: string;
  public_description: string;
  timezone: "Atlantic/Madeira";
  activities: Array<Pick<WeekActivityV1, "day" | "name" | "date" | "starts_at" | "ends_at" | "location" | "link">>;
  proposal_fields: Array<Pick<ProposalFieldV1, "label" | "required">>;
  presentation_minutes: number;
  question_minutes: number;
}

function text(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}

function time(value: unknown): value is string { return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }

function calendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function activity(value: unknown): value is WeekActivityV1 {
  return isRecord(value) && identifier(value.id) && (value.day === "tuesday" || value.day === "wednesday") && text(value.name, 1, 160) && calendarDate(value.date) && time(value.starts_at) && time(value.ends_at) && value.starts_at < value.ends_at && text(value.location, 1, 240) && (value.link === null || typeof value.link === "string" && normalizeOptionalUrl(value.link) === value.link);
}

function proposalField(value: unknown): value is ProposalFieldV1 {
  return isRecord(value) && identifier(value.id) && text(value.label, 1, 160) && typeof value.required === "boolean";
}

function dateAfter(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function seedWeekConfiguration(slot: ProvisionedWeek, edits: Pick<WeekConfigurationV1, "theme" | "public_description"> = { theme: "", public_description: "" }): WeekConfigurationV1 {
  return {
    v: 1, type: "week-configuration", cohort_id: slot.cohort_id, week_number: slot.week_number, timezone: "Atlantic/Madeira", status: "setup", intake_open: false,
    theme: edits.theme, public_description: edits.public_description,
    activities: [
      { id: `week-${slot.week_number}-tuesday-talk`, day: "tuesday", name: "Tuesday talks", date: dateAfter(slot.start_date, 1), starts_at: "18:00", ends_at: "20:00", location: "To be confirmed", link: null },
      { id: `week-${slot.week_number}-wednesday-workshop`, day: "wednesday", name: "Wednesday workshop", date: dateAfter(slot.start_date, 2), starts_at: "18:00", ends_at: "20:00", location: "To be confirmed", link: null },
    ],
    proposal_fields: [
      { id: `week-${slot.week_number}-proposal-title`, label: "Proposal title", required: true },
      { id: `week-${slot.week_number}-proposal-summary`, label: "Proposal summary", required: true },
    ],
    presentation_minutes: 6, question_minutes: 2, base_event_id: null,
  };
}

export function parseWeekConfiguration(value: unknown): WeekConfigurationV1 | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !CONFIGURATION_KEYS.has(key)) || value.v !== 1 || value.type !== "week-configuration" || !identifier(value.cohort_id) || typeof value.week_number !== "number" || !Number.isInteger(value.week_number) || value.week_number < 1) return null;
  if (value.timezone !== "Atlantic/Madeira" || !["setup", "active", "completed"].includes(String(value.status)) || typeof value.intake_open !== "boolean" || value.status === "completed" && value.intake_open || !text(value.theme, 1, 120) || !text(value.public_description, 1, 4000)) return null;
  if (!Array.isArray(value.activities) || value.activities.length === 0 || value.activities.length > MAX_ACTIVITIES || !value.activities.every(activity)) return null;
  if (!Array.isArray(value.proposal_fields) || value.proposal_fields.length === 0 || value.proposal_fields.length > MAX_PROPOSAL_FIELDS || !value.proposal_fields.every(proposalField)) return null;
  if (new Set(value.activities.map((item) => item.id)).size !== value.activities.length || new Set(value.proposal_fields.map((item) => item.id)).size !== value.proposal_fields.length) return null;
  if (!validDuration(value.presentation_minutes) || !validDuration(value.question_minutes)) return null;
  if (!(value.base_event_id === null || isValidEventId(value.base_event_id))) return null;
  return value as unknown as WeekConfigurationV1;
}

/** The only configuration data that may be rendered in the Phase 1 public preview. */
export function publicWeekProjection(configuration: WeekConfigurationV1): PublicWeekProjection {
  return {
    theme: configuration.theme,
    public_description: configuration.public_description,
    timezone: configuration.timezone,
    activities: configuration.activities.map(({ day, name, date, starts_at, ends_at, location, link }) => ({
      day, name, date, starts_at, ends_at, location, link: link ? normalizeOptionalUrl(link) : null,
    })),
    proposal_fields: configuration.proposal_fields.map(({ label, required }) => ({ label, required })),
    presentation_minutes: configuration.presentation_minutes,
    question_minutes: configuration.question_minutes,
  };
}

export type WeekValidation = {
  valid: boolean;
  sections: Record<"week_details" | "tuesday_activities" | "wednesday_activities" | "proposal_form" | "demo_day_timing", string[]>;
};

const validDuration = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 180;
const activityGroup = (configuration: WeekConfigurationV1, day: WeekActivityV1["day"]) => configuration.activities.filter((item) => item.day === day);

function nextId(existing: Iterable<string>, prefix: string): string {
  const ids = new Set(existing);
  let index = 1;
  while (ids.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

export function addActivity(configuration: WeekConfigurationV1, day: WeekActivityV1["day"]): WeekConfigurationV1 {
  if (configuration.activities.length >= MAX_ACTIVITIES) return configuration;
  const existing = activityGroup(configuration, day);
  const template = existing[existing.length - 1] ?? configuration.activities.find((item) => item.day === day);
  const id = nextId(configuration.activities.map((item) => item.id), `week-${configuration.week_number}-${day}-activity`);
  const fallbackDate = day === "tuesday" ? configuration.activities.find((item) => item.day === "tuesday")?.date ?? "" : configuration.activities.find((item) => item.day === "wednesday")?.date ?? "";
  const added: WeekActivityV1 = { id, day, name: "New activity", date: template?.date ?? fallbackDate, starts_at: template?.starts_at ?? "18:00", ends_at: template?.ends_at ?? "19:00", location: template?.location ?? "To be confirmed", link: null };
  const lastIndex = configuration.activities.reduce((index, item, current) => item.day === day ? current : index, -1);
  return { ...configuration, activities: [...configuration.activities.slice(0, lastIndex + 1), added, ...configuration.activities.slice(lastIndex + 1)] };
}

export function removeActivity(configuration: WeekConfigurationV1, id: string): WeekConfigurationV1 {
  const activities = configuration.activities.filter((item) => item.id !== id);
  return activities.length === configuration.activities.length ? configuration : { ...configuration, activities };
}

export function moveActivity(configuration: WeekConfigurationV1, id: string, direction: -1 | 1): WeekConfigurationV1 {
  const current = configuration.activities.findIndex((item) => item.id === id);
  if (current < 0) return configuration;
  const target = configuration.activities.findIndex((item, index) => index !== current && item.day === configuration.activities[current]?.day && (direction < 0 ? index === current - 1 : index === current + 1));
  if (target < 0) return configuration;
  const activities = [...configuration.activities];
  [activities[current], activities[target]] = [activities[target]!, activities[current]!];
  return { ...configuration, activities };
}

export function updateActivity(configuration: WeekConfigurationV1, id: string, changes: Partial<WeekActivityV1>): WeekConfigurationV1 {
  const index = configuration.activities.findIndex((item) => item.id === id);
  if (index < 0 || "id" in changes || "day" in changes) return configuration;
  const activities = [...configuration.activities];
  const current = activities[index]!;
  const rawLink = changes.link;
  activities[index] = { ...current, ...changes, ...(rawLink === undefined ? {} : { link: rawLink === null ? null : normalizeOptionalUrl(rawLink) }) };
  return { ...configuration, activities };
}

export function addProposalField(configuration: WeekConfigurationV1): WeekConfigurationV1 {
  if (configuration.proposal_fields.length >= MAX_PROPOSAL_FIELDS) return configuration;
  const id = nextId(configuration.proposal_fields.map((item) => item.id), `week-${configuration.week_number}-proposal-field`);
  return { ...configuration, proposal_fields: [...configuration.proposal_fields, { id, label: "New field", required: false }] };
}

export function removeProposalField(configuration: WeekConfigurationV1, id: string): WeekConfigurationV1 {
  const proposal_fields = configuration.proposal_fields.filter((item) => item.id !== id);
  return proposal_fields.length === configuration.proposal_fields.length ? configuration : { ...configuration, proposal_fields };
}

export function moveProposalField(configuration: WeekConfigurationV1, id: string, direction: -1 | 1): WeekConfigurationV1 {
  const current = configuration.proposal_fields.findIndex((item) => item.id === id);
  const target = current + direction;
  if (current < 0 || target < 0 || target >= configuration.proposal_fields.length) return configuration;
  const proposal_fields = [...configuration.proposal_fields];
  [proposal_fields[current], proposal_fields[target]] = [proposal_fields[target]!, proposal_fields[current]!];
  return { ...configuration, proposal_fields };
}

export function updateProposalField(configuration: WeekConfigurationV1, id: string, changes: Partial<Omit<ProposalFieldV1, "id">>): WeekConfigurationV1 {
  const index = configuration.proposal_fields.findIndex((item) => item.id === id);
  if (index < 0) return configuration;
  const proposal_fields = [...configuration.proposal_fields];
  proposal_fields[index] = { ...proposal_fields[index]!, ...changes };
  return { ...configuration, proposal_fields };
}

export function validateProposalAnswers(schema: ProposalFieldV1[], answersByFieldId: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(schema.filter((field) => field.required && !answersByFieldId[field.id]?.trim()).map((field) => [field.id, "This field is required."]));
}

export function validateWeekConfiguration(configuration: WeekConfigurationV1): WeekValidation {
  const sections: WeekValidation["sections"] = { week_details: [], tuesday_activities: [], wednesday_activities: [], proposal_form: [], demo_day_timing: [] };
  if (!text(configuration.theme, 1, 120)) sections.week_details.push("Enter a theme.");
  if (!text(configuration.public_description, 1, 4000)) sections.week_details.push("Enter a public description.");
  for (const day of ["tuesday", "wednesday"] as const) {
    const errors = sections[`${day}_activities`];
    const items = activityGroup(configuration, day);
    if (!items.length) errors.push(`Add a ${day} activity.`);
    for (const item of items) {
      if (!activity(item as unknown)) errors.push(`Complete ${item.name || "this activity"}.`);
    }
  }
  if (!configuration.proposal_fields.length) sections.proposal_form.push("Add a field before publishing this week.");
  if (configuration.proposal_fields.length > MAX_PROPOSAL_FIELDS || new Set(configuration.proposal_fields.map((item) => item.id)).size !== configuration.proposal_fields.length || !configuration.proposal_fields.every(proposalField)) sections.proposal_form.push("Complete the proposal fields.");
  if (!validDuration(configuration.presentation_minutes) || !validDuration(configuration.question_minutes)) sections.demo_day_timing.push("Use whole minutes from 1 to 180.");
  return { valid: Object.values(sections).every((errors) => errors.length === 0), sections };
}
