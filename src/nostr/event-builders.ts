import { APP_KIND, DEFAULT_RELAYS, DELETION_KIND, GIFT_WRAP_KIND, PRIVATE_PROPOSAL_KIND, PRIVATE_SCHEDULE_KIND, PROFILE_KIND, WEEK_ARCHIVE_KIND, ZAP_REQUEST_KIND } from "../config/relays.js";
import type { PrivateProposal, PrivateSchedule, PublicSchedule, WeekArchive } from "../domain/cabin.js";
import { parsePrivateProposal, parsePrivateSchedule, parsePublicSchedule, parseWeekArchive, validateProposalForWeek } from "../domain/cabin.js";
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
import { cloneTags, entryD, getTag } from "../domain/utils.js";
import { encodeLnurl } from "./bech32.js";
import { finalizeEvent, generateSecretKeyHex, getPublicKey, nip44Encrypt } from "./crypto.js";
import { localSigner, type EventSigner } from "./signer.js";

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
  proposal: PrivateProposal;
  slot: ProvisionedWeek;
  configuration: WeekConfigurationV1;
  configurationEventId: string;
  secretKeyHex: string;
  createdAt: number;
}): Promise<{ captain: NostrEvent; inner: NostrEvent }> {
  return buildPrivateProposalEventsWithSigner({ proposal, slot, configuration, configurationEventId, signer: localSigner(secretKeyHex), createdAt });
}

export async function buildPrivateProposalEventsWithSigner({
  proposal, slot, configuration, configurationEventId, signer, createdAt,
}: {
  proposal: PrivateProposal;
  slot: ProvisionedWeek;
  configuration: WeekConfigurationV1;
  configurationEventId: string;
  signer: EventSigner;
  createdAt: number;
}): Promise<{ captain: NostrEvent; inner: NostrEvent }> {
  const author = signer.publicKey;
  if (!parsePrivateProposal(proposal) || proposal.author_pubkey !== author) throw new Error("Invalid private proposal");
  const errors = validateProposalForWeek(proposal, author, slot, configuration, configurationEventId);
  if (errors.length) throw new Error(errors[0]);
  const inner = await signer.signEvent({
    kind: PRIVATE_PROPOSAL_KIND, created_at: createdAt,
    tags: [["t", "captains-cabin-private-proposal"]], content: JSON.stringify(proposal),
  });
  return {
    captain: await giftWrap(inner, slot.captain_pubkey, createdAt),
    inner,
  };
}

export async function buildPrivateScheduleEvent({
  schedule, slot, secretKeyHex, createdAt,
}: { schedule: PrivateSchedule; slot: ProvisionedWeek; secretKeyHex: string; createdAt: number }): Promise<{ wrap: NostrEvent; inner: NostrEvent }> {
  return buildPrivateScheduleEventWithSigner({ schedule, slot, signer: localSigner(secretKeyHex), createdAt });
}

export async function buildPrivateScheduleEventWithSigner({
  schedule, slot, signer, createdAt,
}: { schedule: PrivateSchedule; slot: ProvisionedWeek; signer: EventSigner; createdAt: number }): Promise<{ wrap: NostrEvent; inner: NostrEvent }> {
  const captain = signer.publicKey;
  if (captain !== slot.captain_pubkey || !parsePrivateSchedule(schedule) || schedule.cohort_id !== slot.cohort_id || schedule.week_number !== slot.week_number) throw new Error("Only the assigned captain can save this schedule");
  const inner = await signer.signEvent({ kind: PRIVATE_SCHEDULE_KIND, created_at: createdAt, tags: [["t", "captains-cabin-private-schedule"]], content: JSON.stringify(schedule) });
  return { wrap: await giftWrap(inner, captain, createdAt), inner };
}

export async function buildPublicScheduleEvent({
  schedule, slot, secretKeyHex, createdAt,
}: { schedule: PublicSchedule; slot: ProvisionedWeek; secretKeyHex: string; createdAt: number }): Promise<NostrEvent> {
  return buildPublicScheduleEventWithSigner({ schedule, slot, signer: localSigner(secretKeyHex), createdAt });
}

export async function buildPublicScheduleEventWithSigner({
  schedule, slot, signer, createdAt,
}: { schedule: PublicSchedule; slot: ProvisionedWeek; signer: EventSigner; createdAt: number }): Promise<NostrEvent> {
  if (signer.publicKey !== slot.captain_pubkey || !parsePublicSchedule(schedule) || schedule.cohort_id !== slot.cohort_id || schedule.week_number !== slot.week_number) throw new Error("Only the assigned captain can publish a valid schedule");
  return signer.signEvent({ kind: APP_KIND, created_at: createdAt, tags: [["d", `captains-cabin:schedule:${slot.cohort_id}:${slot.week_number}`], ["t", "captains-cabin-public-schedule"]], content: JSON.stringify(schedule) });
}

export async function buildWeekArchiveEvent({
  archive, slot, secretKeyHex, createdAt,
}: { archive: WeekArchive; slot: ProvisionedWeek; secretKeyHex: string; createdAt: number }): Promise<NostrEvent> {
  return buildWeekArchiveEventWithSigner({ archive, slot, signer: localSigner(secretKeyHex), createdAt });
}

export async function buildWeekArchiveEventWithSigner({
  archive, slot, signer, createdAt,
}: { archive: WeekArchive; slot: ProvisionedWeek; signer: EventSigner; createdAt: number }): Promise<NostrEvent> {
  if (signer.publicKey !== slot.captain_pubkey || !parseWeekArchive(archive) || archive.cohort_id !== slot.cohort_id || archive.week_number !== slot.week_number) throw new Error("Only the assigned captain can archive a valid week");
  return signer.signEvent({ kind: WEEK_ARCHIVE_KIND, created_at: createdAt, tags: [["d", `captains-cabin:archive:${slot.cohort_id}:${slot.week_number}`], ["t", "captains-cabin-week-archive"]], content: JSON.stringify(archive) });
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
  return buildWeekConfigurationEventWithSigner({ slot, configuration, signer: localSigner(secretKeyHex), createdAt });
}

export async function buildWeekConfigurationEventWithSigner({
  slot,
  configuration,
  signer,
  createdAt,
}: {
  slot: ProvisionedWeek;
  configuration: WeekConfigurationV1;
  signer: EventSigner;
  createdAt: number;
}): Promise<NostrEvent> {
  if (!isAssignedCaptain(slot, signer.publicKey)) throw new Error("Only the assigned captain can configure this week");
  if (configuration.cohort_id !== slot.cohort_id || configuration.week_number !== slot.week_number) throw new Error("Week configuration does not match its manifest slot");
  if (!parseWeekConfiguration(configuration)) throw new Error("Week configuration is incomplete or invalid");
  return signer.signEvent({
    kind: APP_KIND,
    created_at: createdAt,
    tags: [["d", weekD(slot)], ["t", "captains-cabin-week"]],
    content: JSON.stringify(configuration),
  });
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

export async function buildEntryDeletionEvent({
  targetEvent,
  targetAddress,
  secretKeyHex,
  createdAt,
}: {
  targetEvent: NostrEvent;
  targetAddress: string;
  secretKeyHex: string;
  createdAt: number;
}): Promise<NostrEvent> {
  if (targetEvent.kind !== APP_KIND || getPublicKey(secretKeyHex) !== targetEvent.pubkey) throw new Error("Only the demo author can delete this entry");
  if (targetAddress !== `${APP_KIND}:${targetEvent.pubkey}:${getTag(targetEvent, "d") ?? ""}`) throw new Error("Invalid demo entry address");
  return finalizeEvent({
    kind: DELETION_KIND,
    created_at: createdAt,
    tags: [["e", targetEvent.id], ["a", targetAddress], ["k", String(APP_KIND)]],
    content: "Participant removed their Demo Day submission.",
  }, secretKeyHex);
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
