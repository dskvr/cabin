import { DEFAULT_RELAYS, PROFILE_KIND } from "../config/relays.js";
import type { ImportedProfile, LocalIdentityV1, NostrEvent, ProfileMetadata, ProfileView, RelayEvent } from "../domain/types.js";
import { compareReplaceable, dedupe, safeJsonParse, shorten } from "../domain/utils.js";
import { npubEncode } from "./bech32.js";
import { copyProfileToEphemeralKey } from "./event-builders.js";
import type { NostrRepository } from "./repository.js";

export function parseProfileMetadata(event: NostrEvent | null | undefined): ProfileMetadata {
  if (!event || event.kind !== PROFILE_KIND) return {};
  const parsed = safeJsonParse(event.content);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as ProfileMetadata)
    : {};
}

export function profileDisplayName(metadata: ProfileMetadata, fallbackNpub: string): string {
  const displayName = typeof metadata.display_name === "string" ? metadata.display_name.trim() : "";
  const name = typeof metadata.name === "string" ? metadata.name.trim() : "";
  return displayName || name || shorten(fallbackNpub, 12, 8);
}

export function profileView(event: NostrEvent | null, fallbackPubkey: string): ProfileView {
  const metadata = parseProfileMetadata(event);
  const npub = npubEncode(fallbackPubkey);
  return {
    event,
    metadata,
    name: profileDisplayName(metadata, npub),
    picture: typeof metadata.picture === "string" && metadata.picture.trim() ? metadata.picture : null,
    npub,
  };
}

function chooseLatest(events: RelayEvent[]): RelayEvent | null {
  let selected: RelayEvent | null = null;
  for (const candidate of events) {
    if (!selected || compareReplaceable(candidate.event, selected.event)) selected = candidate;
  }
  return selected;
}

export function canonicalProfileSearchEvents(events: RelayEvent[], limit = 8): RelayEvent[] {
  const latestByPubkey = new Map<string, RelayEvent>();
  for (const item of events) {
    const current = latestByPubkey.get(item.event.pubkey);
    if (!current || compareReplaceable(item.event, current.event)) latestByPubkey.set(item.event.pubkey, item);
  }

  const canonicalByContent = new Map<string, RelayEvent>();
  for (const item of latestByPubkey.values()) {
    const current = canonicalByContent.get(item.event.content);
    if (!current
      || item.event.created_at < current.event.created_at
      || item.event.created_at === current.event.created_at && item.event.id < current.event.id) {
      canonicalByContent.set(item.event.content, item);
    }
  }
  return [...canonicalByContent.values()].slice(0, limit);
}

export async function findRealProfile({
  repository,
  realPubkey,
  additionalRelays = [],
}: {
  repository: NostrRepository;
  realPubkey: string;
  additionalRelays?: string[];
}): Promise<{ event: NostrEvent; relay: string } | null> {
  const relays = dedupe([...DEFAULT_RELAYS, ...additionalRelays]);
  const events = await repository.queryRaw(relays, {
    kinds: [PROFILE_KIND],
    authors: [realPubkey],
    limit: 1,
  });
  const selected = chooseLatest(events);
  return selected ? { event: selected.event, relay: selected.relay } : null;
}

export async function importProfile({
  repository,
  identity,
  sourceEvent,
  sourceRelay,
}: {
  repository: NostrRepository;
  identity: LocalIdentityV1;
  sourceEvent: NostrEvent;
  sourceRelay: string;
}): Promise<ImportedProfile> {
  const previous = identity.copied_profile_event_id
    ? repository.getEventById(identity.copied_profile_event_id)
    : repository.getProfile(identity.public_key_hex);
  const now = Math.floor(Date.now() / 1000);
  const createdAt = previous ? Math.max(now, previous.created_at + 1) : now;
  const copiedEvent = await copyProfileToEphemeralKey({
    source: sourceEvent,
    secretKeyHex: identity.secret_key_hex,
    createdAt,
  });
  await repository.publish(copiedEvent);
  return {
    sourceEvent,
    sourceRelay,
    copiedEvent,
    metadata: parseProfileMetadata(sourceEvent),
  };
}
