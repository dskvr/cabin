import type { ProvisionedWeek } from "./cohort.js";
import { isRecord, isValidEventId } from "./utils.js";

const MAX_ACTIVITIES = 64;
const MAX_PROPOSAL_FIELDS = 32;
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

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
  status: "setup";
  intake_open: false;
  theme: string;
  public_description: string;
  activities: WeekActivityV1[];
  proposal_fields: ProposalFieldV1[];
  presentation_minutes: number;
  question_minutes: number;
  base_event_id: string | null;
}

function text(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}

function time(value: unknown): value is string { return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }

function activity(value: unknown): value is WeekActivityV1 {
  return isRecord(value) && ID.test(String(value.id)) && (value.day === "tuesday" || value.day === "wednesday") && text(value.name, 1, 160) && /^\d{4}-\d{2}-\d{2}$/.test(String(value.date)) && time(value.starts_at) && time(value.ends_at) && text(value.location, 1, 240) && (value.link === null || text(value.link, 1, 2048));
}

function proposalField(value: unknown): value is ProposalFieldV1 {
  return isRecord(value) && ID.test(String(value.id)) && text(value.label, 1, 160) && typeof value.required === "boolean";
}

export function seedWeekConfiguration(slot: ProvisionedWeek, edits: Pick<WeekConfigurationV1, "theme" | "public_description"> = { theme: "", public_description: "" }): WeekConfigurationV1 {
  return {
    v: 1, type: "week-configuration", cohort_id: slot.cohort_id, week_number: slot.week_number, timezone: "Atlantic/Madeira", status: "setup", intake_open: false,
    theme: edits.theme, public_description: edits.public_description,
    activities: [
      { id: `week-${slot.week_number}-tuesday-talk`, day: "tuesday", name: "Tuesday talks", date: slot.start_date, starts_at: "18:00", ends_at: "20:00", location: "To be confirmed", link: null },
      { id: `week-${slot.week_number}-wednesday-workshop`, day: "wednesday", name: "Wednesday workshop", date: slot.end_date, starts_at: "18:00", ends_at: "20:00", location: "To be confirmed", link: null },
    ],
    proposal_fields: [
      { id: `week-${slot.week_number}-proposal-title`, label: "Proposal title", required: true },
      { id: `week-${slot.week_number}-proposal-summary`, label: "Proposal summary", required: true },
    ],
    presentation_minutes: 6, question_minutes: 2, base_event_id: null,
  };
}

export function parseWeekConfiguration(value: unknown): WeekConfigurationV1 | null {
  if (!isRecord(value) || value.v !== 1 || value.type !== "week-configuration" || typeof value.cohort_id !== "string" || !ID.test(value.cohort_id) || !Number.isInteger(value.week_number) || value.week_number < 1) return null;
  if (value.timezone !== "Atlantic/Madeira" || value.status !== "setup" || value.intake_open !== false || !text(value.theme, 1, 120) || !text(value.public_description, 1, 4000)) return null;
  if (!Array.isArray(value.activities) || value.activities.length === 0 || value.activities.length > MAX_ACTIVITIES || !value.activities.every(activity)) return null;
  if (!Array.isArray(value.proposal_fields) || value.proposal_fields.length === 0 || value.proposal_fields.length > MAX_PROPOSAL_FIELDS || !value.proposal_fields.every(proposalField)) return null;
  if (new Set(value.activities.map((item) => item.id)).size !== value.activities.length || new Set(value.proposal_fields.map((item) => item.id)).size !== value.proposal_fields.length) return null;
  if (!Number.isInteger(value.presentation_minutes) || value.presentation_minutes < 1 || value.presentation_minutes > 60 || !Number.isInteger(value.question_minutes) || value.question_minutes < 1 || value.question_minutes > 60) return null;
  if (!(value.base_event_id === null || isValidEventId(value.base_event_id))) return null;
  return value as unknown as WeekConfigurationV1;
}
