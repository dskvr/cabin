import { APP_KIND, DEFAULT_RELAYS, GIFT_WRAP_KIND, PRIVATE_PROPOSAL_KIND, PRIVATE_SCHEDULE_KIND, PROFILE_KIND, ZAP_REQUEST_KIND } from "../config/relays.js";
import type { PrivateProposalV1, PrivateScheduleV1, PublicScheduleV1, WeekArchiveV1 } from "../domain/cabin.js";
import { parsePrivateProposal, parsePrivateSchedule } from "../domain/cabin.js";
import type {
  DemoDaySessionV1,
  NostrEvent,
  ParticipantEntryV1,
  ProfileMetadata,
} from "../domain/types.js";
import { isAssignedCaptain } from "../domain/authorization.js";
import type { ProvisionedWeek } from "../domain/cohort.js";
import { weekD } from "../domain/cohort.js";
import type { WeekConfigurationV1 } from "../domain/week.js";
import { parseWeekConfiguration } from "../domain/week.js";
import { cloneTags, entryD } from "../domain/utils.js";
import { encodeLnurl } from "./bech32.js";
import { finalizeEvent, generateSecretKeyHex, getPublicKey, nip44Encrypt } from "./crypto.js";

async function giftWrap(inner: NostrEvent, recipientPubkey: string, createdAt: number): Promise<NostrEvent> {
  const ephemeralSecret = generateSecretKeyHex();
  return finalizeEvent({
    kind: GIFT_WRAP_KIND,
    created_at: createdAt,
    tags: [["p", recipientPubkey]],
    content: await nip44Encrypt(JSON.stringify(inner), ephemeralSecret, recipientPubkey),
  }, ephemeralSecret);
}

export async function buildPrivateProposalEvents({
  proposal, slot, configuration, configurationEventId, secretKeyHex, createdAt,
}: {
  proposal: PrivateProposalV1;
  slot: ProvisionedWeek;
  configuration: WeekConfigurationV1;
  configurationEventId: string;
  secretKeyHex: string;
  createdAt: number;
}): Promise<{ captain: NostrEvent; participant: NostrEvent; inner: NostrEvent }> {
  const author = getPublicKey(secretKeyHex);
  if (!parsePrivateProposal(proposal) || proposal.author_pubkey !== author) throw new Error("Invalid private proposal");
  const { validateProposalForWeek } = await import("../domain/cabin.js");
  const errors = validateProposalForWeek(proposal, author, slot, configuration, configurationEventId);
  if (errors.length) throw new Error(errors[0]);
  const inner = await finalizeEvent({
    kind: PRIVATE_PROPOSAL_KIND, created_at: createdAt,
    tags: [["t", "captains-cabin-private-proposal"]], content: JSON.stringify(proposal),
  }, secretKeyHex);
  return {
    captain: await giftWrap(inner, slot.captain_pubkey, createdAt),
    participant: await giftWrap(inner, author, createdAt),
    inner,
  };
}

export async function buildPrivateScheduleEvent({
  schedule, slot, secretKeyHex, createdAt,
}: { schedule: PrivateScheduleV1; slot: ProvisionedWeek; secretKeyHex: string; createdAt: number }): Promise<{ wrap: NostrEvent; inner: NostrEvent }> {
  const captain = getPublicKey(secretKeyHex);
  if (captain !== slot.captain_pubkey || !parsePrivateSchedule(schedule) || schedule.cohort_id !== slot.cohort_id || schedule.week_number !== slot.week_number) throw new Error("Only the assigned captain can save this schedule");
  const inner = await finalizeEvent({ kind: PRIVATE_SCHEDULE_KIND, created_at: createdAt, tags: [["t", "captains-cabin-private-schedule"]], content: JSON.stringify(schedule) }, secretKeyHex);
  return { wrap: await giftWrap(inner, captain, createdAt), inner };
}

export async function buildPublicScheduleEvent({
  schedule, slot, secretKeyHex, createdAt,
}: { schedule: PublicScheduleV1; slot: ProvisionedWeek; secretKeyHex: string; createdAt: number }): Promise<NostrEvent> {
  if (getPublicKey(secretKeyHex) !== slot.captain_pubkey || schedule.cohort_id !== slot.cohort_id || schedule.week_number !== slot.week_number) throw new Error("Only the assigned captain can publish this schedule");
  return finalizeEvent({ kind: APP_KIND, created_at: createdAt, tags: [["d", `captains-cabin:schedule:${slot.cohort_id}:${slot.week_number}`], ["t", "captains-cabin-public-schedule"]], content: JSON.stringify(schedule) }, secretKeyHex);
}

export async function buildWeekArchiveEvent({
  archive, slot, secretKeyHex, createdAt,
}: { archive: WeekArchiveV1; slot: ProvisionedWeek; secretKeyHex: string; createdAt: number }): Promise<NostrEvent> {
  if (getPublicKey(secretKeyHex) !== slot.captain_pubkey || archive.cohort_id !== slot.cohort_id || archive.week_number !== slot.week_number) throw new Error("Only the assigned captain can archive this week");
  return finalizeEvent({ kind: APP_KIND, created_at: createdAt, tags: [["d", `captains-cabin:archive:${slot.cohort_id}:${slot.week_number}`], ["t", "captains-cabin-week-archive"]], content: JSON.stringify(archive) }, secretKeyHex);
}

export async function buildSessionEvent({
  sessionD,
  state,
  secretKeyHex,
  createdAt,
}: {
  sessionD: string;
  state: DemoDaySessionV1;
  secretKeyHex: string;
  createdAt: number;
}): Promise<NostrEvent> {
  return finalizeEvent(
    {
      kind: APP_KIND,
      created_at: createdAt,
      tags: [
        ["d", sessionD],
        ["t", "sedd-session"],
      ],
      content: JSON.stringify(state),
    },
    secretKeyHex,
  );
}

export async function buildWeekConfigurationEvent({
  slot,
  configuration,
  secretKeyHex,
  createdAt,
}: {
  slot: ProvisionedWeek;
  configuration: WeekConfigurationV1;
  secretKeyHex: string;
  createdAt: number;
}): Promise<NostrEvent> {
  const signer = getPublicKey(secretKeyHex);
  if (!isAssignedCaptain(slot, signer)) throw new Error("Only the assigned captain can configure this week");
  if (configuration.cohort_id !== slot.cohort_id || configuration.week_number !== slot.week_number) throw new Error("Week configuration does not match its manifest slot");
  if (!parseWeekConfiguration(configuration)) throw new Error("Week configuration is incomplete or invalid");
  return finalizeEvent({
    kind: APP_KIND,
    created_at: createdAt,
    tags: [["d", weekD(slot)], ["t", "captains-cabin-week"]],
    content: JSON.stringify(configuration),
  }, secretKeyHex);
}

export async function buildEntryEvent({
  sessionAddress,
  sessionD,
  entry,
  profile,
  secretKeyHex,
  createdAt,
}: {
  sessionAddress: string;
  sessionD: string;
  entry: ParticipantEntryV1;
  profile: ProfileMetadata;
  secretKeyHex: string;
  createdAt: number;
}): Promise<NostrEvent> {
  const tags: string[][] = [
    ["d", entryD(sessionD)],
    ["t", "sedd-entry"],
    ["a", sessionAddress],
    ["p", entry.real_pubkey, entry.source_profile_relay, "presenter"],
  ];
  const hasLightningAddress =
    (typeof profile.lud16 === "string" && profile.lud16.trim().length > 0) ||
    (typeof profile.lud06 === "string" && profile.lud06.trim().length > 0);
  if (hasLightningAddress) {
    tags.push(["zap", entry.real_pubkey, entry.source_profile_relay, "1"]);
  }
  return finalizeEvent(
    {
      kind: APP_KIND,
      created_at: createdAt,
      tags,
      content: JSON.stringify(entry),
    },
    secretKeyHex,
  );
}

export async function copyProfileToEphemeralKey({
  source,
  secretKeyHex,
  createdAt,
}: {
  source: NostrEvent;
  secretKeyHex: string;
  createdAt: number;
}): Promise<NostrEvent> {
  if (source.kind !== PROFILE_KIND) throw new Error("Source profile must be kind 0");
  return finalizeEvent(
    {
      kind: PROFILE_KIND,
      created_at: createdAt,
      tags: cloneTags(source.tags),
      content: source.content,
    },
    secretKeyHex,
  );
}

export async function createPresenterZapRequest({
  entryEvent,
  presenterRealPubkey,
  amountMsat,
  comment,
  lnurl,
  secretKeyHex,
}: {
  entryEvent: NostrEvent;
  presenterRealPubkey: string;
  amountMsat: number;
  comment: string;
  lnurl: string;
  secretKeyHex: string;
}): Promise<NostrEvent> {
  const d = entryEvent.tags.find((tag) => tag[0] === "d")?.[1];
  if (!d) throw new Error("Entry event has no d tag");
  const address = `${APP_KIND}:${entryEvent.pubkey}:${d}`;
  return finalizeEvent(
    {
      kind: ZAP_REQUEST_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: comment,
      tags: [
        ["relays", ...DEFAULT_RELAYS],
        ["amount", String(amountMsat)],
        ["lnurl", encodeLnurl(lnurl)],
        ["p", presenterRealPubkey],
        ["a", address],
        ["k", String(APP_KIND)],
      ],
    },
    secretKeyHex,
  );
}
