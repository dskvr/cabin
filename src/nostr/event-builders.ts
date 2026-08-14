import { APP_KIND, DEFAULT_RELAYS, PROFILE_KIND, ZAP_REQUEST_KIND } from "../config/relays.js";
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
import { finalizeEvent, getPublicKey } from "./crypto.js";

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
