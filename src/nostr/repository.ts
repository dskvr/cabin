import {
  APP_KIND,
  DEFAULT_RELAYS,
  GIFT_WRAP_KIND,
  PENDING_PUBLISH_STORAGE_KEY,
  PROFILE_KIND,
  ZAP_RECEIPT_KIND,
  WEEK_ARCHIVE_KIND,
} from "../config/relays.js";
import type {
  NostrEvent,
  NostrFilter,
  ParsedEntry,
  ParsedSession,
  RelayEvent,
  SelectedSession,
} from "../domain/types.js";
import { weekD, type ProvisionedWeek } from "../domain/cohort.js";
import type { ParsedWeekConfiguration } from "./event-parsers.js";
import type { PrivateProposal, PrivateSchedule, PublicSchedule, WeekArchive } from "../domain/cabin.js";
import { compareReplaceable, dedupe } from "../domain/utils.js";
import { verifyEvent } from "./crypto.js";
import { EventIndex } from "./event-index.js";
import { parseParticipantEntryEvent, parsePrivateProposalGift, parsePrivateScheduleGift, parsePublicScheduleEvent, parseSessionEvent, parseWeekArchiveEvent, parseWeekConfigurationEvent } from "./event-parsers.js";
import type { NostrTransport } from "./transport.js";

interface PendingPublish {
  event: NostrEvent;
  addedAtMs: number;
}

const MAX_RELAY_CONTENT_BYTES = 65_536;
const MAX_RELAY_TAGS = 256;
const MAX_RELAY_TAG_ELEMENTS = 16;
const MAX_RELAY_TAG_STRING_LENGTH = 1_024;

function hasBoundedUtf8Length(value: string, maximum: number): boolean {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) length += 1;
    else if (code <= 0x7ff) length += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      length += 4;
      index += 1;
    } else length += 3;
    if (length > maximum) return false;
  }
  return true;
}

/** Reject oversized relay payloads before serializing or verifying untrusted data. */
function hasSafeRelayBounds(event: NostrEvent): boolean {
  if (typeof event.content !== "string" || !hasBoundedUtf8Length(event.content, MAX_RELAY_CONTENT_BYTES)) return false;
  if (!Array.isArray(event.tags) || event.tags.length > MAX_RELAY_TAGS) return false;
  return event.tags.every((tag) =>
    Array.isArray(tag) && tag.length <= MAX_RELAY_TAG_ELEMENTS &&
    tag.every((value) => typeof value === "string" && value.length <= MAX_RELAY_TAG_STRING_LENGTH),
  );
}

function storageOrNull(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function loadPending(): PendingPublish[] {
  const raw = storageOrNull()?.getItem(PENDING_PUBLISH_STORAGE_KEY);
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is PendingPublish =>
      typeof item === "object" && item !== null &&
      typeof (item as PendingPublish).addedAtMs === "number" &&
      typeof (item as PendingPublish).event === "object" && (item as PendingPublish).event !== null
    );
  } catch {
    return [];
  }
}

function savePending(pending: PendingPublish[]): void {
  const storage = storageOrNull();
  if (!storage) return;
  if (pending.length === 0) storage.removeItem(PENDING_PUBLISH_STORAGE_KEY);
  else storage.setItem(PENDING_PUBLISH_STORAGE_KEY, JSON.stringify(pending));
}

export class NostrRepository {
  readonly #transport: NostrTransport;
  readonly #verify: typeof verifyEvent;
  readonly #index = new EventIndex();
  readonly #seenOn = new Map<string, Set<string>>();
  readonly #listeners = new Set<() => void>();
  readonly #validity = new Map<string, Promise<boolean>>();
  readonly #unsubscribers: Array<() => void> = [];
  #started = false;
  #pending = loadPending();

  constructor(transport: NostrTransport, verify: typeof verifyEvent = verifyEvent) {
    this.#transport = transport;
    this.#verify = verify;
  }

  get transport(): NostrTransport {
    return this.#transport;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#unsubscribers.push(
      this.#transport.subscribe(DEFAULT_RELAYS, {
        kinds: [APP_KIND],
        "#t": ["sedd-session"],
        limit: 200,
      }, {
        onevent: (item) => void this.ingest(item),
      }),
      this.#transport.subscribe(DEFAULT_RELAYS, {
        kinds: [APP_KIND],
        "#t": ["sedd-entry"],
        limit: 1_000,
      }, {
        onevent: (item) => void this.ingest(item),
      }),
    );
    void this.retryPending();
    globalThis.addEventListener?.("online", this.#handleOnline);
  }

  stop(): void {
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe();
    globalThis.removeEventListener?.("online", this.#handleOnline);
    this.#transport.close();
    this.#started = false;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async ingest(item: RelayEvent): Promise<boolean> {
    if (!hasSafeRelayBounds(item.event)) return false;
    let validity = this.#validity.get(item.event.id);
    if (!validity) {
      validity = this.#verify(item.event);
      if (!(await validity)) return false;
      // A verified ID has a verified hash and signature. Negative results are
      // intentionally not cached: another relay may provide the authentic event.
      this.#validity.set(item.event.id, Promise.resolve(true));
    } else if (!(await validity)) {
      return false;
    }
    const seen = this.#seenOn.get(item.event.id) ?? new Set<string>();
    seen.add(item.relay);
    this.#seenOn.set(item.event.id, seen);
    const changed = this.#index.ingest(item.event);
    if (changed) this.#notify();
    return changed;
  }

  async queryRaw(
    relays: readonly string[],
    filter: NostrFilter,
    options: { maxWait?: number } = {},
  ): Promise<RelayEvent[]> {
    const raw = await this.#transport.query(relays, filter, options);
    const valid: RelayEvent[] = [];
    for (const item of raw) {
      if (hasSafeRelayBounds(item.event) && await this.#verify(item.event)) {
        valid.push(item);
        await this.ingest(item);
      }
    }
    return valid;
  }

  async publish(event: NostrEvent): Promise<void> {
    await this.ingest({ event, relay: "local" });
    if (!this.#pending.some((item) => item.event.id === event.id)) {
      this.#pending.push({ event, addedAtMs: Date.now() });
      savePending(this.#pending);
    }
    try {
      await this.#transport.publish(DEFAULT_RELAYS, event, { maxWait: 4_000 });
      this.#pending = this.#pending.filter((item) => item.event.id !== event.id);
      savePending(this.#pending);
    } catch (error) {
      this.#notify();
      throw error;
    }
  }

  async publishAll(events: readonly NostrEvent[]): Promise<void> {
    for (const event of events) await this.publish(event);
  }

  async retryPending(): Promise<void> {
    for (const pending of [...this.#pending]) {
      try {
        await this.#transport.publish(DEFAULT_RELAYS, pending.event, { maxWait: 4_000 });
        this.#pending = this.#pending.filter((item) => item.event.id !== pending.event.id);
        savePending(this.#pending);
      } catch {
        // Retain for the next reconnect or startup.
      }
    }
    this.#notify();
  }

  pendingCount(): number {
    return this.#pending.length;
  }

  /** Return the newest queued, manifest-authorized event for this exact week coordinate. */
  pendingWeek(slot: ProvisionedWeek): NostrEvent | null {
    return this.#pending
      .map((item) => item.event)
      .filter((event) => parseWeekConfigurationEvent(event, slot) !== null)
      .reduce<NostrEvent | null>((latest, event) =>
        !latest || compareReplaceable(event, latest) ? event : latest,
      null);
  }

  seenOn(eventId: string): string[] {
    return [...(this.#seenOn.get(eventId) ?? [])].filter((relay) => relay !== "local").sort();
  }

  connectedRelays(): string[] {
    return this.#transport.connectedRelays();
  }

  getEventById(id: string): NostrEvent | undefined {
    return this.#index.getById(id);
  }

  getProfile(pubkey: string): NostrEvent | null {
    return this.#index.get(`${PROFILE_KIND}:${pubkey}`) ?? null;
  }

  sessions(): ParsedSession[] {
    return this.#index.values()
      .map(parseSessionEvent)
      .filter((session): session is ParsedSession => session !== null)
      .sort((a, b) => b.state.created_at_ms - a.state.created_at_ms || a.address.localeCompare(b.address));
  }

  activeSessions(): ParsedSession[] {
    return this.sessions().filter((session) => session.state.closed_at_ms === null);
  }

  getSession(selected: SelectedSession): ParsedSession | null {
    const event = this.#index.get(`${APP_KIND}:${selected.captainPubkey}:${selected.d}`);
    if (!event) return null;
    const parsed = parseSessionEvent(event);
    return parsed && parsed.address === selected.address ? parsed : null;
  }

  getWeek(slot: ProvisionedWeek): ParsedWeekConfiguration | null {
    // The generic addressable-event index intentionally stores every verified event.
    // Week state is stricter: select only semantic, manifest-authorized candidates so
    // a later validly signed but unauthorized payload can never hide an accepted week.
    const candidates = this.#index.allEvents()
      .map((event) => parseWeekConfigurationEvent(event, slot))
      .filter((parsed): parsed is ParsedWeekConfiguration => parsed !== null);
    const archive = this.weekArchive(slot);
    if (archive) return candidates.find((candidate) => candidate.event.id === archive.archive.configuration_event_id) ?? null;
    return candidates.reduce<ParsedWeekConfiguration | null>((latest, candidate) =>
      !latest || compareReplaceable(candidate.event, latest.event) ? candidate : latest,
    null);
  }

  async refreshWeek(slot: ProvisionedWeek): Promise<ParsedWeekConfiguration | null> {
    await this.queryRaw(DEFAULT_RELAYS, {
      kinds: [APP_KIND], authors: [slot.captain_pubkey], "#d": [weekD(slot)], limit: 20,
    });
    return this.getWeek(slot);
  }

  subscribeWeek(slot: ProvisionedWeek): () => void {
    return this.#transport.subscribe(DEFAULT_RELAYS, {
      kinds: [APP_KIND], authors: [slot.captain_pubkey], "#d": [weekD(slot)],
    }, { onevent: (item) => void this.ingest(item) });
  }

  async privateProposals({ slot, configuration, configurationEventId, recipientSecretKeyHex }: {
    slot: ProvisionedWeek;
    configuration: ParsedWeekConfiguration["configuration"];
    configurationEventId: string;
    recipientSecretKeyHex: string;
  }): Promise<Array<{ event: NostrEvent; inner: NostrEvent; proposal: PrivateProposal }>> {
    const recipient = (await import("./crypto.js")).getPublicKey(recipientSecretKeyHex);
    await Promise.all([
      this.queryRaw(DEFAULT_RELAYS, { kinds: [GIFT_WRAP_KIND], "#p": [recipient], limit: 1_000 }),
      this.queryRaw(DEFAULT_RELAYS, { kinds: [APP_KIND], authors: [slot.captain_pubkey], "#d": [weekD(slot)], limit: 100 }),
    ]);
    const revisions = this.#index.allEvents().map((event) => parseWeekConfigurationEvent(event, slot)).filter((item): item is ParsedWeekConfiguration => item !== null);
    if (!revisions.some((item) => item.event.id === configurationEventId)) return [];
    const gifts = this.#index.allEvents().filter((event) => event.kind === GIFT_WRAP_KIND);
    const parsed = (await Promise.all(gifts.flatMap((event) => revisions.map(async (revision) => {
      const item = await parsePrivateProposalGift({ event, recipientSecretKeyHex, slot, configuration: revision.configuration, configurationEventId: revision.event.id });
      if (!item) return null;
      const effective = revisions.filter((candidate) => candidate.event.created_at <= item.inner.created_at).reduce<ParsedWeekConfiguration | null>((latest, candidate) => !latest || compareReplaceable(candidate.event, latest.event) ? candidate : latest, null);
      return effective?.event.id === revision.event.id ? item : null;
    })))).filter((item): item is NonNullable<typeof item> => item !== null);
    const latest = new Map<string, NonNullable<(typeof parsed)[number]>>();
    for (const item of parsed) {
      if (!item) continue;
      const key = `${item.proposal.author_pubkey}:${item.proposal.proposal_id}`;
      const current = latest.get(key);
      if (!current || item.inner.created_at > current.inner.created_at || item.inner.created_at === current.inner.created_at && item.inner.id > current.inner.id) latest.set(key, item);
    }
    return [...latest.values()].sort((a, b) => a.proposal.updated_at_ms - b.proposal.updated_at_ms);
  }

  async privateSchedule(slot: ProvisionedWeek, recipientSecretKeyHex: string): Promise<{ event: NostrEvent; inner: NostrEvent; schedule: PrivateSchedule } | null> {
    await this.queryRaw(DEFAULT_RELAYS, { kinds: [GIFT_WRAP_KIND], "#p": [slot.captain_pubkey], limit: 1_000 });
    const parsed = await Promise.all(this.#index.allEvents().map((event) => parsePrivateScheduleGift(event, recipientSecretKeyHex, slot)));
    return parsed.filter((item): item is NonNullable<typeof item> => item !== null).reduce<NonNullable<(typeof parsed)[number]> | null>((latest, item) =>
      !latest || item.inner.created_at > latest.inner.created_at || item.inner.created_at === latest.inner.created_at && item.inner.id > latest.inner.id ? item : latest,
    null);
  }

  publicSchedule(slot: ProvisionedWeek): { event: NostrEvent; schedule: PublicSchedule } | null {
    const candidates = this.#index.allEvents().map((event) => {
      const schedule = parsePublicScheduleEvent(event, slot);
      return schedule ? { event, schedule } : null;
    }).filter((item): item is { event: NostrEvent; schedule: PublicSchedule } => item !== null);
    return candidates.reduce<(typeof candidates)[number] | null>((latest, item) => !latest || compareReplaceable(item.event, latest.event) ? item : latest, null);
  }

  async refreshPublicSchedule(slot: ProvisionedWeek): Promise<{ event: NostrEvent; schedule: PublicSchedule } | null> {
    await this.queryRaw(DEFAULT_RELAYS, { kinds: [APP_KIND], authors: [slot.captain_pubkey], "#d": [`captains-cabin:schedule:${slot.cohort_id}:${slot.week_number}`], limit: 20 });
    return this.publicSchedule(slot);
  }

  weekArchive(slot: ProvisionedWeek): { event: NostrEvent; archive: WeekArchive } | null {
    const candidates = this.#index.allEvents().map((event) => {
      const archive = parseWeekArchiveEvent(event, slot);
      const configurationEvent = archive ? this.getEventById(archive.configuration_event_id) : null;
      const configuration = configurationEvent ? parseWeekConfigurationEvent(configurationEvent, slot) : null;
      return archive && configuration?.configuration.status === "completed" ? { event, archive } : null;
    }).filter((item): item is { event: NostrEvent; archive: WeekArchive } => item !== null);
    return candidates.reduce<(typeof candidates)[number] | null>((earliest, item) => !earliest || item.event.created_at < earliest.event.created_at || item.event.created_at === earliest.event.created_at && item.event.id < earliest.event.id ? item : earliest, null);
  }

  async refreshWeekArchive(slot: ProvisionedWeek): Promise<{ event: NostrEvent; archive: WeekArchive } | null> {
    await this.queryRaw(DEFAULT_RELAYS, { kinds: [WEEK_ARCHIVE_KIND], authors: [slot.captain_pubkey], "#d": [`captains-cabin:archive:${slot.cohort_id}:${slot.week_number}`], limit: 20 });
    const configurationIds = this.#index.allEvents().map((event) => parseWeekArchiveEvent(event, slot)?.configuration_event_id).filter((id): id is string => Boolean(id));
    await this.fetchEventsByIds(configurationIds);
    return this.weekArchive(slot);
  }

  entriesForSession(address: string): ParsedEntry[] {
    return this.#index.values()
      .map((event) => parseParticipantEntryEvent(event, address))
      .filter((entry): entry is ParsedEntry => entry !== null)
      .sort((a, b) => a.author.localeCompare(b.author));
  }

  entryForParticipant(address: string, pubkey: string): ParsedEntry | null {
    return this.entriesForSession(address).find((entry) => entry.author === pubkey) ?? null;
  }

  zapEvents(): NostrEvent[] {
    return this.#index.allEvents().filter((event) => event.kind === ZAP_RECEIPT_KIND);
  }

  async ensureProfile(pubkey: string, relays: readonly string[] = DEFAULT_RELAYS): Promise<NostrEvent | null> {
    const existing = this.getProfile(pubkey);
    if (existing) return existing;
    await this.queryRaw(relays, { kinds: [PROFILE_KIND], authors: [pubkey], limit: 1 });
    return this.getProfile(pubkey);
  }

  async refreshSession(selected: SelectedSession): Promise<void> {
    await Promise.all([
      this.queryRaw(DEFAULT_RELAYS, {
        kinds: [APP_KIND],
        authors: [selected.captainPubkey],
        "#d": [selected.d],
        limit: 20,
      }),
      this.queryRaw(DEFAULT_RELAYS, {
        kinds: [APP_KIND],
        "#a": [selected.address],
        "#t": ["sedd-entry"],
        limit: 500,
      }),
    ]);
    const authors = dedupe([
      selected.captainPubkey,
      ...this.entriesForSession(selected.address).map((entry) => entry.author),
    ]);
    if (authors.length > 0) {
      await this.queryRaw(DEFAULT_RELAYS, {
        kinds: [PROFILE_KIND],
        authors,
        limit: authors.length,
      });
    }
  }

  async refreshZaps(entries: ParsedEntry[]): Promise<void> {
    const addresses = entries.map((entry) => entry.address);
    const recipients = entries.map((entry) => entry.content.real_pubkey);
    if (addresses.length === 0) return;
    await this.queryRaw(DEFAULT_RELAYS, {
      kinds: [ZAP_RECEIPT_KIND],
      "#a": addresses,
      "#p": recipients,
      limit: 1_000,
    });
  }

  subscribeSession(selected: SelectedSession): () => void {
    const stops = [
      this.#transport.subscribe(DEFAULT_RELAYS, {
        kinds: [APP_KIND],
        authors: [selected.captainPubkey],
        "#d": [selected.d],
      }, { onevent: (item) => void this.ingest(item) }),
      this.#transport.subscribe(DEFAULT_RELAYS, {
        kinds: [APP_KIND],
        "#a": [selected.address],
        "#t": ["sedd-entry"],
      }, { onevent: (item) => void this.ingest(item) }),
    ];
    return () => stops.forEach((stop) => stop());
  }

  subscribeZaps(entries: ParsedEntry[]): () => void {
    if (entries.length === 0) return () => undefined;
    return this.#transport.subscribe(DEFAULT_RELAYS, {
      kinds: [ZAP_RECEIPT_KIND],
      "#a": entries.map((entry) => entry.address),
      "#p": entries.map((entry) => entry.content.real_pubkey),
    }, { onevent: (item) => void this.ingest(item) });
  }

  async fetchEventsByIds(ids: string[]): Promise<NostrEvent[]> {
    const unique = dedupe(ids);
    const found = new Map<string, NostrEvent>();
    for (const id of unique) {
      const local = this.getEventById(id);
      if (local) found.set(id, local);
    }
    const missing = unique.filter((id) => !found.has(id));
    for (let offset = 0; offset < missing.length; offset += 100) {
      const chunk = missing.slice(offset, offset + 100);
      const events = await this.queryRaw(DEFAULT_RELAYS, { ids: chunk, limit: chunk.length });
      for (const item of events) found.set(item.event.id, item.event);
    }
    return unique.map((id) => found.get(id)).filter((event): event is NostrEvent => event !== undefined);
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }

  readonly #handleOnline = (): void => {
    void this.retryPending();
  };
}
