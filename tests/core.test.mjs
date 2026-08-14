import test from "node:test";
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";

import {
  finalizeEvent,
  generateSecretKeyHex,
  getPublicKey,
  nip44Decrypt,
  nip44Encrypt,
  sha256,
  verifyEvent,
} from "../dist/assets/nostr/crypto.js";
import {
  cloneWeekConfiguration,
  configurationForArchive,
  parsePrivateProposal,
  parsePrivateSchedule,
  parsePublicSchedule,
  publicScheduleProjection,
  proposalIdFor,
  scheduleWarnings,
  validateProposalForWeek,
} from "../dist/assets/domain/cabin.js";
import {
  decodeLnurl,
  decodeNaddr,
  decodeNpub,
  decodeNsec,
  naddrEncode,
  npubEncode,
  nsecEncode,
} from "../dist/assets/nostr/bech32.js";
import { EventIndex } from "../dist/assets/nostr/event-index.js";
import {
  buildEntryEvent,
  buildSessionEvent,
  buildWeekConfigurationEvent,
  copyProfileToEphemeralKey,
  createPresenterZapRequest,
} from "../dist/assets/nostr/event-builders.js";
import {
  parseParticipantEntryEvent,
  parseSessionEvent,
  parseWeekConfigurationEvent,
} from "../dist/assets/nostr/event-parsers.js";
import {
  calculateTimer,
  formatTimer,
  sessionTimerDurations,
  splitPresentationTime,
} from "../dist/assets/domain/timer.js";
import {
  addActivity,
  addProposalField,
  moveActivity,
  moveProposalField,
  removeActivity,
  removeProposalField,
  publicWeekProjection,
  parseWeekConfiguration,
  seedWeekConfiguration,
  updateActivity,
  updateProposalField,
  validateProposalAnswers,
  validateWeekConfiguration,
  MAX_WEEK_CONFIGURATION_CONTENT_LENGTH,
} from "../dist/assets/domain/week.js";
import { sessionBelongsToWeek, weekD } from "../dist/assets/domain/cohort.js";
import { parseRoute } from "../dist/assets/app/router.js";
import { calculateElo, rankElo } from "../dist/assets/domain/elo.js";
import { calculateFollowSuggestions } from "../dist/assets/domain/follows.js";
import {
  buildExport,
  containsSecretMaterial,
  exportFilename,
} from "../dist/assets/domain/export.js";
import {
  collectZapReceipts,
  parseBolt11AmountMsat,
  parseZapReceipt,
  requestZapInvoice,
  zapTotals,
} from "../dist/assets/nostr/zaps.js";
import { getTag } from "../dist/assets/domain/utils.js";
import { canonicalProfileSearchEvents, profileDisplayName } from "../dist/assets/nostr/profiles.js";
import {
  APP_KIND,
  DEFAULT_RELAYS,
  PRESENTATION_MS,
  QUESTIONS_MS,
} from "../dist/assets/config/relays.js";

const key = (number) => number.toString(16).padStart(64, "0");
const sessionD = "sedd-session:0123456789abcdef0123456789abcdef";

test("profile search collapses copied metadata onto original oldest profile", () => {
  const content = JSON.stringify({ name: "gsovereignty", nip05: "gsovereignty@nostrovia.org" });
  const profile = (pubkey, createdAt, id) => ({
    relay: "wss://search.example",
    event: { id, pubkey, created_at: createdAt, kind: 0, tags: [], content, sig: "00".repeat(64) },
  });
  const original = profile(key(3), 100, "03".repeat(32));
  const copyOne = profile(key(4), 200, "04".repeat(32));
  const copyTwo = profile(key(5), 300, "05".repeat(32));

  assert.deepEqual(canonicalProfileSearchEvents([copyTwo, copyOne, original]), [original]);
});

test("profile display names render on one line", () => {
  assert.equal(
    profileDisplayName({ display_name: "  Alice\n  Example  ", name: "ignored" }, "npub1fallback"),
    "Alice Example",
  );
  assert.equal(
    profileDisplayName({ name: "Alice\tExample" }, "npub1fallback"),
    "Alice Example",
  );
});

test("SHA-256 works when SubtleCrypto is unavailable on an insecure LAN origin", async () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { getRandomValues: crypto.getRandomValues.bind(crypto) },
  });
  try {
    assert.equal(
      Buffer.from(await sha256("abc")).toString("hex"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  } finally {
    if (cryptoDescriptor) Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
  }
});

test("NIP-44 encryption matches the official vector and authenticates before decrypting", async () => {
  const nonce = Uint8Array.from({ length: 32 }, (_, index) => index === 31 ? 1 : 0);
  const expected = "AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABee0G5VSK0/9YypIObAtDKfYEAjD35uVkHyB0F4DwrcNaCXlCWZKaArsGrY6M9wnuTMxWfp1RTN9Xga8no+kF5Vsb";
  const encrypted = await nip44Encrypt("a", key(1), getPublicKey(key(2)), nonce);
  assert.equal(encrypted, expected);
  assert.equal(await nip44Decrypt(encrypted, key(2), getPublicKey(key(1))), "a");
  const tampered = encrypted.slice(0, -2) + (encrypted.at(-2) === "A" ? "B" : "A") + encrypted.at(-1);
  await assert.rejects(nip44Decrypt(tampered, key(2), getPublicKey(key(1))), /authentication|base64/);
  await assert.rejects(nip44Decrypt("A".repeat(65_537), key(2), getPublicKey(key(1))), /length/);
});

test("private proposal validation binds author, whitelist, active week, revision, and stable field IDs", () => {
  const author = getPublicKey(key(12));
  const slot = { cohort_id: "madeira-2026", week_number: 2, start_date: "2026-08-18", end_date: "2026-08-24", timezone: "Atlantic/Madeira", captain_pubkey: getPublicKey(key(11)), participant_allowlist: [author] };
  const configuration = { ...seedWeekConfiguration(slot, { theme: "Privacy", public_description: "Private proposals." }), status: "active", intake_open: true };
  const proposal = {
    v: 1, type: "captains-cabin-proposal", proposal_id: proposalIdFor(slot, author), cohort_id: slot.cohort_id,
    week_number: slot.week_number, configuration_event_id: "ab".repeat(32), author_pubkey: author,
    answers: Object.fromEntries(configuration.proposal_fields.map((field) => [field.id, "Answer"])),
    created_at_ms: 1000, updated_at_ms: 1000,
  };
  assert.ok(parsePrivateProposal(proposal));
  assert.deepEqual(validateProposalForWeek(proposal, author, slot, configuration, proposal.configuration_event_id), []);
  assert.match(validateProposalForWeek(proposal, getPublicKey(key(13)), slot, configuration, proposal.configuration_event_id).join(" "), /author|whitelisted/);
  assert.match(validateProposalForWeek({ ...proposal, answers: { unknown: "leak" } }, author, slot, configuration, proposal.configuration_event_id).join(" "), /unknown|required/);
  assert.match(validateProposalForWeek(proposal, author, slot, { ...configuration, intake_open: false }, proposal.configuration_event_id).join(" "), /closed/);
  assert.match(validateProposalForWeek(proposal, author, slot, configuration, "cd".repeat(32)).join(" "), /stale/);
});

test("private schedule warnings and public projection preserve an exact privacy boundary", () => {
  const slot = { cohort_id: "madeira-2026", week_number: 2, start_date: "2026-08-18", end_date: "2026-08-24", timezone: "Atlantic/Madeira", captain_pubkey: getPublicKey(key(14)), participant_allowlist: [] };
  const configuration = { ...seedWeekConfiguration(slot, { theme: "Schedule", public_description: "A public schedule." }), status: "active", intake_open: false };
  const activity = configuration.activities[0];
  assert.ok(activity);
  const schedule = {
    v: 1, type: "captains-cabin-private-schedule", draft_id: "draft-one", cohort_id: slot.cohort_id,
    week_number: slot.week_number, configuration_event_id: "01".repeat(32), base_event_id: null,
    decisions: [{ proposal_id: "proposal-one", decision: "accepted" }, { proposal_id: "proposal-two", decision: "rejected" }],
    placements: [
      { id: "placement-one", proposal_id: "proposal-one", activity_id: activity.id, starts_at: "17:30", ends_at: "18:30", public_title: "Selected title", public_presenter: "Alice", public_description: "Approved copy" },
      { id: "placement-two", proposal_id: "proposal-one", activity_id: activity.id, starts_at: "18:15", ends_at: "18:45", public_title: "Second", public_presenter: "Alice", public_description: "" },
      { id: "placement-three", proposal_id: "proposal-two", activity_id: activity.id, starts_at: "19:00", ends_at: "19:30", public_title: "Rejected", public_presenter: "Mallory", public_description: "private answer" },
    ], updated_at_ms: 10,
  };
  assert.ok(parsePrivateSchedule(schedule));
  const warnings = scheduleWarnings(schedule, configuration).join(" ");
  assert.match(warnings, /outside/);
  assert.match(warnings, /more than once/);
  assert.match(warnings, /overlaps/);
  assert.match(warnings, /not accepted/);
  configuration.activities.push({ id: "monday-hike", day: "monday", name: "Morning hike", date: "", starts_at: "", ends_at: "", location: "", link: null });
  const projection = publicScheduleProjection(schedule, configuration, "02".repeat(32), "publication-one", 20);
  const serialized = JSON.stringify(projection);
  assert.match(serialized, /Selected title/);
  assert.doesNotMatch(serialized, /Rejected|private answer|proposal-one|proposal-two|decisions|answers/);
  assert.equal(projection.activities.flatMap((item) => item.sessions).length, 2);
  assert.equal(projection.activities.find((item) => item.day === "monday")?.name, "Morning hike");
  assert.deepEqual(parsePublicSchedule(projection), projection);
  assert.equal(parsePublicSchedule({ ...projection, answers: { secret: "leak" } }), null, "public payloads reject extra top-level keys");
  assert.equal(parsePublicSchedule({ ...projection, activities: [{ ...projection.activities[0], sessions: [{ ...projection.activities[0].sessions[0], proposal_id: "private" }] }] }), null, "public sessions reject private coordinates");
});

test("configuration cloning creates fresh structural IDs and copies no operational state", () => {
  const sourceSlot = { cohort_id: "madeira-2026", week_number: 1, start_date: "2026-08-12", end_date: "2026-08-18", timezone: "Atlantic/Madeira", captain_pubkey: getPublicKey(key(15)), participant_allowlist: [] };
  const targetSlot = { ...sourceSlot, week_number: 4, start_date: "2026-09-02", end_date: "2026-09-08", captain_pubkey: getPublicKey(key(16)) };
  const source = { ...seedWeekConfiguration(sourceSlot, { theme: "Reusable", public_description: "Configuration only." }), status: "completed", intake_open: false, base_event_id: "03".repeat(32) };
  let sequence = 0;
  const clone = cloneWeekConfiguration(source, targetSlot, () => `fresh${++sequence}`);
  assert.equal(clone.status, "setup");
  assert.equal(clone.intake_open, false);
  assert.equal(clone.base_event_id, null);
  assert.equal(clone.week_number, 4);
  assert.deepEqual(clone.activities.map((item) => item.name), source.activities.map((item) => item.name));
  assert.deepEqual(clone.activities.map((item) => item.date), ["2026-09-03", "2026-09-04"], "cloned Tuesday and Wednesday activities use the target week's dates");
  assert.equal(clone.activities.some((item) => source.activities.some((old) => old.id === item.id)), false);
  assert.equal(clone.proposal_fields.some((item) => source.proposal_fields.some((old) => old.id === item.id)), false);
  const archived = configurationForArchive(source);
  assert.equal("base_event_id" in archived, false);
  assert.equal("status" in archived, false);
  assert.equal("intake_open" in archived, false);
});

function sessionState(overrides = {}) {
  return {
    v: 1,
    type: "session",
    name: "Test Demo Day",
    created_at_ms: 1_700_000_000_000,
    closed_at_ms: null,
    current_demo_pubkey: null,
    timer_started_at_ms: null,
    presented: [],
    final_elo: null,
    snapshot_entry_ids: null,
    snapshot_profile_ids: null,
    snapshot_zap_ids: null,
    ...overrides,
  };
}

test("Demo Day discovery excludes sessions outside the derived cohort week", () => {
  const slot = {
    cohort_id: "sec-08",
    week_number: 4,
    start_date: "2026-08-10",
    end_date: "2026-08-14",
    timezone: "Atlantic/Madeira",
    captain_pubkey: "ab".repeat(32),
    participant_allowlist: [],
  };
  const at = (value) => Date.parse(`${value}T12:00:00Z`);

  assert.equal(sessionBelongsToWeek(sessionState({ created_at_ms: at("2026-08-09") }), slot), false);
  assert.equal(sessionBelongsToWeek(sessionState({ created_at_ms: at("2026-08-10") }), slot), true);
  assert.equal(sessionBelongsToWeek(sessionState({ created_at_ms: at("2026-08-14"), cohort_id: "sec-08", week_number: 4 }), slot), true);
  assert.equal(sessionBelongsToWeek(sessionState({ created_at_ms: at("2026-08-14"), cohort_id: "sec-08", week_number: 3 }), slot), false);
  assert.equal(sessionBelongsToWeek(sessionState({ created_at_ms: at("2026-08-15") }), slot), false);
});

function entryState(realPubkey, sourceProfileEventId, demoName, ranking = [], feedback = {}) {
  return {
    v: 1,
    type: "entry",
    real_pubkey: realPubkey,
    source_profile_event_id: sourceProfileEventId,
    source_profile_relay: "wss://profile.example",
    demo: {
      name: demoName,
      description: `${demoName} description`,
      link: "https://example.com/demo",
    },
    ranking,
    feedback,
    updated_at_ms: 1_700_000_001_000,
  };
}

test("BIP-340 signing produces valid Nostr events and detects tampering", async () => {
  const secret = key(1);
  const event = await finalizeEvent({
    kind: 1,
    created_at: 1_700_000_000,
    tags: [["t", "test"]],
    content: "signed message",
  }, secret);

  assert.equal(event.pubkey, getPublicKey(secret));
  assert.equal(event.id.length, 64);
  assert.equal(event.sig.length, 128);
  assert.equal(await verifyEvent(event), true);
  assert.equal(await verifyEvent({ ...event, content: "tampered" }), false);
});

test("secp256k1 x-only public keys match Node's independent curve implementation", () => {
  const secrets = [key(1), key(2), key(3), key(0x12345)];
  for (const secret of secrets) {
    const ecdh = createECDH("secp256k1");
    ecdh.setPrivateKey(Buffer.from(secret, "hex"));
    const compressed = ecdh.getPublicKey("hex", "compressed");
    assert.equal(getPublicKey(secret), compressed.slice(2));
  }
  assert.equal(getPublicKey(key(3)), "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9");
});

test("NIP-19 npub, nsec, and naddr round-trip", () => {
  const secret = key(2);
  const pubkey = getPublicKey(secret);
  const npub = npubEncode(pubkey);
  const nsec = nsecEncode(secret);
  const naddr = naddrEncode({
    kind: APP_KIND,
    pubkey,
    identifier: sessionD,
    relays: DEFAULT_RELAYS.slice(0, 3),
  });

  assert.equal(decodeNpub(npub), pubkey);
  assert.equal(decodeNsec(nsec), secret);
  assert.deepEqual(decodeNaddr(naddr), {
    kind: APP_KIND,
    pubkey,
    identifier: sessionD,
    relays: DEFAULT_RELAYS.slice(0, 3),
  });
});

test("replaceable event index selects newest timestamp and lower ID on ties", () => {
  const pubkey = "1".repeat(64);
  const base = {
    pubkey,
    kind: APP_KIND,
    tags: [["d", sessionD], ["t", "sedd-session"]],
    content: "{}",
    sig: "0".repeat(128),
  };
  const index = new EventIndex();
  const oldEvent = { ...base, id: "e".repeat(64), created_at: 10 };
  const newerEvent = { ...base, id: "f".repeat(64), created_at: 11 };
  const tieHigherId = { ...base, id: "d".repeat(64), created_at: 12 };
  const tieLowerId = { ...base, id: "0".repeat(64), created_at: 12 };

  assert.equal(index.ingest(oldEvent), true);
  assert.equal(index.ingest(newerEvent), true);
  assert.equal(index.ingest(tieHigherId), true);
  assert.equal(index.ingest(tieLowerId), true);
  assert.equal(index.get(`${APP_KIND}:${pubkey}:${sessionD}`)?.id, tieLowerId.id);
  assert.equal(index.ingest(tieLowerId), false, "deduplicates by event ID");
});

test("profile copy preserves exact raw content and all tags", async () => {
  const source = await finalizeEvent({
    kind: 0,
    created_at: 100,
    tags: [["custom", "one", "two"], ["alt", "profile"]],
    content: '{"name":"Alice","custom":{"nested":true},"nip05":"alice@example.com"}',
  }, key(3));
  const copied = await copyProfileToEphemeralKey({
    source,
    secretKeyHex: key(4),
    createdAt: 101,
  });

  assert.equal(copied.content, source.content);
  assert.deepEqual(copied.tags, source.tags);
  assert.notEqual(copied.pubkey, source.pubkey);
  assert.equal(await verifyEvent(copied), true);
});

test("session and participant entry builders produce valid, parseable records", async () => {
  const captainSecret = key(5);
  const participantSecret = key(6);
  const realPubkey = getPublicKey(key(7));
  const profile = await finalizeEvent({ kind: 0, created_at: 90, tags: [], content: '{"name":"Presenter","lud16":"p@example.com"}' }, key(7));
  const session = await buildSessionEvent({
    sessionD,
    state: sessionState(),
    secretKeyHex: captainSecret,
    createdAt: 100,
  });
  const parsedSession = parseSessionEvent(session);
  assert.ok(parsedSession);

  const contextualSession = await buildSessionEvent({
    sessionD: "sedd-session:00112233445566778899aabbccddeeff",
    state: { ...sessionState(), cohort_id: "sec-08", week_number: 4, week_configuration_event_id: "ab".repeat(32) },
    secretKeyHex: captainSecret,
    createdAt: 100,
  });
  assert.equal(parseSessionEvent(contextualSession)?.state.week_number, 4, "new Demo Day sessions retain their cohort week route");
  const incompleteContext = await buildSessionEvent({
    sessionD: "sedd-session:ffeeddccbbaa99887766554433221100",
    state: { ...sessionState(), cohort_id: "sec-08" },
    secretKeyHex: captainSecret,
    createdAt: 100,
  });
  assert.equal(parseSessionEvent(incompleteContext), null, "partial cohort coordinates fail closed");

  const entry = await buildEntryEvent({
    sessionAddress: parsedSession.address,
    sessionD,
    entry: entryState(realPubkey, profile.id, "Sensor Network"),
    profile: { name: "Presenter", lud16: "p@example.com" },
    secretKeyHex: participantSecret,
    createdAt: 101,
  });
  const parsedEntry = parseParticipantEntryEvent(entry, parsedSession.address);

  assert.ok(parsedEntry);
  assert.equal(parsedEntry.content.demo.name, "Sensor Network");
  assert.equal(getTag(entry, "a"), parsedSession.address);
  assert.equal(getTag(entry, "zap"), realPubkey);
  assert.equal(await verifyEvent(entry), true);
});

test("entry builder omits zap redirect when copied Lightning fields are blank", async () => {
  const participantSecret = key(61);
  const realSecret = key(62);
  const sourceProfile = await finalizeEvent({
    kind: 0,
    created_at: 1,
    tags: [],
    content: '{"display_name":"No Lightning","lud16":"   ","lud06":""}',
  }, realSecret);
  const event = await buildEntryEvent({
    sessionAddress: `${APP_KIND}:${getPublicKey(key(63))}:${sessionD}`,
    sessionD,
    entry: entryState(getPublicKey(realSecret), sourceProfile.id, "No Zap Demo"),
    profile: { lud16: "   ", lud06: "" },
    secretKeyHex: participantSecret,
    createdAt: 2,
  });

  assert.equal(getTag(event, "zap"), undefined);
  assert.equal(await verifyEvent(event), true);
});

test("timer implements presentation, questions, and overtime boundaries", () => {
  assert.deepEqual(formatTimer(0), { phase: "PRESENTATION", value: "06:00", className: "presentation" });
  assert.deepEqual(formatTimer(PRESENTATION_MS - 1), { phase: "PRESENTATION", value: "00:01", className: "presentation" });
  assert.deepEqual(formatTimer(PRESENTATION_MS), { phase: "QUESTIONS", value: "02:00", className: "questions" });
  assert.deepEqual(formatTimer(PRESENTATION_MS + QUESTIONS_MS - 1), { phase: "QUESTIONS", value: "00:01", className: "questions" });
  assert.deepEqual(formatTimer(PRESENTATION_MS + QUESTIONS_MS), { phase: "OVERTIME", value: "+00:00", className: "overtime" });
  assert.deepEqual(formatTimer(PRESENTATION_MS + QUESTIONS_MS + 18_999), { phase: "OVERTIME", value: "+00:18", className: "overtime" });
  assert.equal(calculateTimer(-100).phase, "presentation");
  assert.deepEqual(splitPresentationTime(498_333), {
    presentation_ms: 360_000,
    questions_ms: 120_000,
    overtime_ms: 18_333,
    total_ms: 498_333,
  });
  const configured = sessionTimerDurations({ presentation_minutes: 1, question_minutes: 2 });
  assert.deepEqual(formatTimer(60_000, configured), { phase: "QUESTIONS", value: "02:00", className: "questions" });
  assert.deepEqual(formatTimer(180_000, configured), { phase: "OVERTIME", value: "+00:00", className: "overtime" });
});

test("Elo uses deterministic presentation-pair order, ignores missing ranks, and excludes presenters", () => {
  const [a, b, c, d] = ["a", "b", "c", "d"].map((letter) => letter.repeat(64));
  const entries = [
    { author: a, content: { ranking: [b, c, a] } },
    { author: b, content: { ranking: [c, a, b] } },
    { author: c, content: { ranking: [a, b, c] } },
    { author: d, content: { ranking: [a, c, b] } },
    { author: "e".repeat(64), content: { ranking: [a] } },
  ];

  const result = calculateElo([a, b, c], entries);
  assert.deepEqual(result.pairs.map((pair) => [pair.demo_a, pair.demo_b]), [[a, b], [a, c], [b, c]]);
  assert.deepEqual(result.pairs.map((pair) => [pair.votes_a_over_b, pair.votes_b_over_a]), [[2, 0], [1, 1], [1, 1]]);
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].pubkey, a);
  assert.equal(rankElo(result.rows)[0].rank, 1);
});

test("follow suggestions use real keys and exclude self, duplicates, and existing follows", () => {
  const own = "1".repeat(64);
  const followed = "2".repeat(64);
  const suggested = "3".repeat(64);
  const malformed = "not-a-key";
  const followEvent = {
    id: "f".repeat(64),
    pubkey: own,
    created_at: 1,
    kind: 3,
    tags: [["p", followed], ["p", malformed]],
    content: "",
    sig: "0".repeat(128),
  };

  assert.deepEqual(calculateFollowSuggestions({
    ownRealPubkey: own,
    participantRealPubkeys: [own, followed, suggested, suggested, malformed],
    followEvent,
  }), [suggested]);
});

test("presenter zap request targets the real pubkey and ephemeral entry coordinate", async () => {
  const participantSecret = key(8);
  const participantPubkey = getPublicKey(participantSecret);
  const realPubkey = getPublicKey(key(9));
  const address = `${APP_KIND}:${getPublicKey(key(10))}:${sessionD}`;
  const sourceProfile = await finalizeEvent({ kind: 0, created_at: 1, tags: [], content: "{}" }, key(9));
  const entryEvent = await buildEntryEvent({
    sessionAddress: address,
    sessionD,
    entry: entryState(realPubkey, sourceProfile.id, "Zap Target"),
    profile: { lud16: "zapper@example.com" },
    secretKeyHex: participantSecret,
    createdAt: 2,
  });
  const request = await createPresenterZapRequest({
    entryEvent,
    presenterRealPubkey: realPubkey,
    amountMsat: 21_000_000,
    comment: "Great demo",
    lnurl: "https://example.com/lnurl",
    secretKeyHex: key(11),
  });

  assert.equal(getTag(request, "p"), realPubkey);
  assert.equal(getTag(request, "a"), `${APP_KIND}:${participantPubkey}:sedd-entry:${sessionD}`);
  assert.equal(getTag(request, "k"), String(APP_KIND));
  assert.match(getTag(request, "lnurl"), /^lnurl1/);
  assert.equal(decodeLnurl(getTag(request, "lnurl")), "https://example.com/lnurl");
  assert.equal(request.kind, 9734);
  assert.equal(await verifyEvent(request), true);
});

test("zap receipt validation verifies both signatures, target, and amount", async () => {
  const presenterSecret = key(12);
  const presenterRealPubkey = getPublicKey(key(13));
  const sourceProfile = await finalizeEvent({ kind: 0, created_at: 1, tags: [], content: "{}" }, key(13));
  const entryEvent = await buildEntryEvent({
    sessionAddress: `${APP_KIND}:${getPublicKey(key(14))}:${sessionD}`,
    sessionD,
    entry: entryState(presenterRealPubkey, sourceProfile.id, "Receipt Demo"),
    profile: { lud16: "receipt@example.com" },
    secretKeyHex: presenterSecret,
    createdAt: 2,
  });
  const request = await createPresenterZapRequest({
    entryEvent,
    presenterRealPubkey,
    amountMsat: 21_000_000,
    comment: "Nice",
    lnurl: "https://example.com/lnurl",
    secretKeyHex: key(15),
  });
  const serviceSecret = key(16);
  const servicePubkey = getPublicKey(serviceSecret);
  const receipt = await finalizeEvent({
    kind: 9735,
    created_at: 3,
    tags: [
      ["description", JSON.stringify(request)],
      ["bolt11", "lnbc210u1not-a-real-invoice-but-amount-is-parseable"],
      ["p", presenterRealPubkey],
      ["a", getTag(request, "a")],
    ],
    content: "",
  }, serviceSecret);
  const targetAddress = getTag(request, "a");
  assert.ok(targetAddress);

  const parsed = await parseZapReceipt({
    receipt,
    expectedRecipient: presenterRealPubkey,
    expectedAddress: targetAddress,
    servicePubkey,
  });
  assert.ok(parsed);
  assert.equal(parsed.amountMsat, 21_000_000);
  assert.equal(parsed.amountSats, 21_000);
  assert.equal(parsed.serviceVerified, true);

  const collected = await collectZapReceipts({
    events: [receipt, receipt],
    entries: [{ address: targetAddress, realPubkey: presenterRealPubkey }],
    servicePubkeys: new Map([[presenterRealPubkey, servicePubkey]]),
  });
  assert.equal(collected.length, 1);
  assert.deepEqual(zapTotals(collected), { count: 1, totalMsat: 21_000_000, totalSats: 21_000 });

  const mismatched = await parseZapReceipt({
    receipt,
    expectedRecipient: getPublicKey(key(17)),
    expectedAddress: targetAddress,
  });
  assert.equal(mismatched, null);

  const wrongService = await parseZapReceipt({
    receipt,
    expectedRecipient: presenterRealPubkey,
    expectedAddress: targetAddress,
    servicePubkey: getPublicKey(key(18)),
  });
  assert.equal(wrongService, null, "a receipt must be authored by the advertised LNURL service key when known");
});

test("zap invoice callback receives required LNURL parameter", async () => {
  const request = await finalizeEvent({
    kind: 9734,
    created_at: 1,
    tags: [
      ["p", getPublicKey(key(18))],
      ["amount", "21000"],
      ["lnurl", "lnurl1testvalue"],
      ["relays", ...DEFAULT_RELAYS],
    ],
    content: "",
  }, key(19));
  let callbackUrl;
  const invoice = await requestZapInvoice({
    metadata: {
      callback: "https://example.com/callback",
      minSendable: 1_000,
      maxSendable: 1_000_000,
      metadata: "[]",
      commentAllowed: 0,
      allowsNostr: true,
      nostrPubkey: getPublicKey(key(20)),
      raw: {},
    },
    amountMsat: 21_000,
    zapRequest: request,
    comment: "",
    fetchImpl: async (input) => {
      callbackUrl = new URL(String(input));
      return new Response(JSON.stringify({ pr: "lnbc210n1invoicevalueover20chars" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(callbackUrl.searchParams.get("amount"), "21000");
  assert.equal(callbackUrl.searchParams.get("lnurl"), "lnurl1testvalue");
  assert.equal(JSON.parse(callbackUrl.searchParams.get("nostr")).id, request.id);
  assert.equal(invoice.invoice, "lnbc210n1invoicevalueover20chars");
});

test("BOLT11 amount parser handles standard multipliers", () => {
  assert.equal(parseBolt11AmountMsat("lnbc1m1anything"), 100_000_000);
  assert.equal(parseBolt11AmountMsat("lnbc10u1anything"), 1_000_000);
  assert.equal(parseBolt11AmountMsat("lntb21n1anything"), 2_100);
  assert.equal(parseBolt11AmountMsat("lnbc100p1anything"), 10);
  assert.equal(parseBolt11AmountMsat("lnbc11p1anything"), null, "pico-BTC must be whole millisats");
  assert.equal(parseBolt11AmountMsat("not-an-invoice"), null);
});

test("AI-ready export includes normalized and raw data and never secret material", async () => {
  const captainSecret = key(18);
  const participantSecret = key(19);
  const captainPubkey = getPublicKey(captainSecret);
  const participantPubkey = getPublicKey(participantSecret);
  const captainRealSecret = key(20);
  const participantRealSecret = key(21);
  const captainRealPubkey = getPublicKey(captainRealSecret);
  const participantRealPubkey = getPublicKey(participantRealSecret);
  const sourceCaptain = await finalizeEvent({ kind: 0, created_at: 1, tags: [["custom", "captain"]], content: '{"display_name":"Captain","custom_field":{"ok":true}}' }, captainRealSecret);
  const sourceParticipant = await finalizeEvent({ kind: 0, created_at: 1, tags: [], content: '{"display_name":"Participant","lud16":"p@example.com"}' }, participantRealSecret);
  const captainProfile = await copyProfileToEphemeralKey({ source: sourceCaptain, secretKeyHex: captainSecret, createdAt: 2 });
  const participantProfile = await copyProfileToEphemeralKey({ source: sourceParticipant, secretKeyHex: participantSecret, createdAt: 2 });
  const address = `${APP_KIND}:${captainPubkey}:${sessionD}`;
  const captainEntryEvent = await buildEntryEvent({
    sessionAddress: address,
    sessionD,
    entry: entryState(captainRealPubkey, sourceCaptain.id, "Captain Demo", [participantPubkey], {
      [participantPubkey]: { liked: "Clear" },
    }),
    profile: { display_name: "Captain" },
    secretKeyHex: captainSecret,
    createdAt: 3,
  });
  const participantEntryEvent = await buildEntryEvent({
    sessionAddress: address,
    sessionD,
    entry: entryState(participantRealPubkey, sourceParticipant.id, "Participant Demo", [captainPubkey]),
    profile: { display_name: "Participant", lud16: "p@example.com" },
    secretKeyHex: participantSecret,
    createdAt: 3,
  });
  const captainEntry = parseParticipantEntryEvent(captainEntryEvent, address);
  const participantEntry = parseParticipantEntryEvent(participantEntryEvent, address);
  assert.ok(captainEntry && participantEntry);
  const presented = [
    { pubkey: captainPubkey, started_at_ms: 1_000, finished_at_ms: 361_000 },
    { pubkey: participantPubkey, started_at_ms: 400_000, finished_at_ms: 898_333 },
  ];
  const elo = rankElo(calculateElo([captainPubkey, participantPubkey], [captainEntry, participantEntry]).rows);
  const closedState = sessionState({
    closed_at_ms: 1_700_000_900_000,
    presented,
    final_elo: elo,
    snapshot_entry_ids: [captainEntryEvent.id, participantEntryEvent.id],
    snapshot_profile_ids: [captainProfile.id, participantProfile.id],
    snapshot_zap_ids: [],
  });
  const sessionEvent = await buildSessionEvent({ sessionD, state: closedState, secretKeyHex: captainSecret, createdAt: 4 });
  const session = parseSessionEvent(sessionEvent);
  assert.ok(session);

  const exported = buildExport({
    session,
    entries: [captainEntry, participantEntry],
    profiles: new Map([[captainPubkey, captainProfile], [participantPubkey, participantProfile]]),
    zapReceipts: [],
    generatedAt: new Date("2026-08-06T20:30:22.123Z"),
  });

  assert.equal(exported.schema, "sedd-export-1");
  assert.equal(exported.generated_at, "2026-08-06T20:30:22.123Z");
  assert.equal(exported.participants.length, 2);
  assert.equal(exported.demos.length, 2);
  assert.equal(exported.raw_events.length, 5);
  assert.equal(exported.totals.completed_demos, 2);
  assert.equal(containsSecretMaterial(exported), false);
  assert.equal(containsSecretMaterial({ secret_key_hex: key(1) }), true);
  assert.equal(containsSecretMaterial({ "private-key": key(1) }), true);
  assert.equal(containsSecretMaterial({ private_notes: "This harmless public profile field is retained." }), false);
  assert.equal(containsSecretMaterial({ privacy: "public profile preference" }), false);
  assert.equal(containsSecretMaterial({ value: nsecEncode(key(1)) }), true);
  assert.equal(JSON.stringify(exported).includes("nsec"), false);
  assert.equal(exportFilename(new Date("2026-08-06T01:00:00.000Z")), "sovereign-engineering-demo-day-2026-08-06.json");
});

test("week activities retain stable identities, order, valid timing, and duration boundaries", () => {
  const slot = { cohort_id: "madeira-2026", week_number: 3, start_date: "2026-01-13", end_date: "2026-01-19", captain_pubkey: key(90) };
  const seeded = seedWeekConfiguration(slot, { theme: "Nostr in Madeira", public_description: "A complete week." });
  const tuesday = seeded.activities.find((item) => item.day === "tuesday");
  const wednesday = seeded.activities.find((item) => item.day === "wednesday");
  assert.ok(tuesday);
  assert.equal(tuesday.name, "Tuesday talks");
  assert.equal(wednesday?.name, "Wednesday workshop");
  const added = addActivity(seeded, "tuesday");
  const addedActivity = added.activities.at(1);
  assert.ok(addedActivity);
  assert.notEqual(addedActivity.id, tuesday.id);
  assert.equal(moveActivity(added, tuesday.id, -1), added, "boundary move is a no-op");
  const renamed = updateActivity(added, addedActivity.id, { name: "Relay workshop", link: "https://example.com/workshop" });
  assert.equal(renamed.activities.at(1)?.id, addedActivity.id);
  assert.equal(renamed.activities.at(1)?.link, "https://example.com/workshop");
  const removed = removeActivity(renamed, addedActivity.id);
  assert.equal(removeActivity(removed, "absent"), removed, "removing an absent ID is a no-op");
  assert.equal(validateWeekConfiguration({ ...removed, presentation_minutes: 1, question_minutes: 2 }).valid, true);
  assert.equal(validateWeekConfiguration({ ...removed, presentation_minutes: 0 }).valid, false);
  assert.equal(validateWeekConfiguration({ ...removed, presentation_minutes: 181 }).valid, false);
  assert.equal(validateWeekConfiguration({ ...removed, presentation_minutes: 1.5 }).valid, false);
  assert.deepEqual(calculateTimer(60_000, { presentationMs: 60_000, questionMs: 120_000 }), { phase: "questions", remainingMs: 120_000 });
  assert.deepEqual(splitPresentationTime(181_000, { presentationMs: 60_000, questionMs: 120_000 }), { presentation_ms: 60_000, questions_ms: 120_000, overtime_ms: 1_000, total_ms: 181_000 });
});

test("captains can add title-only activities to every weekday", () => {
  const slot = { cohort_id: "madeira-2026", week_number: 3, start_date: "2026-01-12", end_date: "2026-01-16", captain_pubkey: key(90), participant_allowlist: [] };
  let configuration = seedWeekConfiguration(slot, { theme: "Flexible week", public_description: "Activities vary by captain." });
  for (const day of ["monday", "tuesday", "wednesday", "thursday", "friday"]) {
    const previousIds = new Set(configuration.activities.map((item) => item.id));
    configuration = addActivity(configuration, day);
    const added = configuration.activities.find((item) => !previousIds.has(item.id));
    assert.ok(added);
    configuration = updateActivity(configuration, added.id, { name: `${day} activity` });
    assert.deepEqual({ date: added.date, starts_at: added.starts_at, ends_at: added.ends_at, location: added.location, link: added.link }, { date: "", starts_at: "", ends_at: "", location: "", link: null });
  }
  assert.equal(validateWeekConfiguration(configuration).valid, true);
  assert.ok(parseWeekConfiguration(configuration), "title-only activities are valid signed configuration data");
  const monday = configuration.activities.find((item) => item.name === "monday activity");
  assert.ok(monday);
  assert.equal(validateWeekConfiguration(updateActivity(configuration, monday.id, { name: "" })).valid, false, "title remains the only required activity field");
});

test("proposal fields keep answer association through rename, reorder, requiredness, and removal", () => {
  const slot = { cohort_id: "madeira-2026", week_number: 3, start_date: "2026-01-13", end_date: "2026-01-19", captain_pubkey: key(91) };
  const seeded = seedWeekConfiguration(slot, { theme: "Nostr in Madeira", public_description: "A complete week." });
  const [title, description] = seeded.proposal_fields;
  assert.ok(title && description);
  const answers = { [title.id]: "Cabin maps", [description.id]: "A private planning graph" };
  const renamed = updateProposalField(seeded, title.id, { label: "Project name" });
  const reordered = moveProposalField(renamed, description.id, -1);
  const optional = updateProposalField(reordered, description.id, { required: false });
  assert.equal(optional.proposal_fields[1]?.id, title.id, "rename and reorder retain the original ID");
  assert.deepEqual(validateProposalAnswers(optional.proposal_fields, answers), {});
  assert.deepEqual(validateProposalAnswers(optional.proposal_fields, { [description.id]: "optional description" }), { [title.id]: "This field is required." });
  assert.equal(moveProposalField(optional, description.id, -1), optional, "boundary move is a no-op");
  assert.equal(removeProposalField(optional, "absent"), optional, "absent removal is a no-op");
  const added = addProposalField(optional);
  assert.equal(new Set(added.proposal_fields.map((field) => field.id)).size, added.proposal_fields.length, "add allocates one unique stable ID");
  const removed = removeProposalField(added, description.id);
  assert.equal(removed.proposal_fields.some((field) => field.id === title.id), true, "removal only affects the selected field");
  assert.equal(validateWeekConfiguration({ ...removed, proposal_fields: [] }).valid, false, "empty schemas block publication");
  assert.equal(validateWeekConfiguration({ ...removed, proposal_fields: [{ ...title, label: "" }] }).valid, false, "empty labels block publication");
  assert.equal(validateWeekConfiguration({ ...removed, proposal_fields: [{ ...title, label: "x".repeat(161) }] }).valid, false, "overlong labels block publication");
});

test("public week projection keeps an exact safe allowlist and normalized public links", () => {
  const slot = { cohort_id: "madeira-2026", week_number: 3, start_date: "2026-01-13", end_date: "2026-01-19", captain_pubkey: key(92), participant_allowlist: [key(93)] };
  const configuration = seedWeekConfiguration(slot, { theme: "<img src=x onerror=alert(1)>", public_description: "<script>unsafe</script>" });
  configuration.activities[0].location = "<b>Harbour</b>";
  configuration.activities[0].link = "javascript:alert(1)";
  configuration.base_event_id = "aa".repeat(32);

  const projection = publicWeekProjection(configuration);
  assert.deepEqual(Object.keys(projection).sort(), ["activities", "presentation_minutes", "proposal_fields", "public_description", "question_minutes", "theme", "timezone"]);
  assert.deepEqual(Object.keys(projection.activities[0]).sort(), ["date", "day", "ends_at", "link", "location", "name", "starts_at"]);
  assert.deepEqual(Object.keys(projection.proposal_fields[0]).sort(), ["label", "required"]);
  assert.equal(projection.activities[0].link, null, "unsafe schemes never reach the public projection");
  assert.equal("participant_allowlist" in projection, false);
  assert.equal("base_event_id" in projection, false);
  assert.equal("intake_open" in projection, false);

  const safe = publicWeekProjection({ ...configuration, activities: [{ ...configuration.activities[0], link: "https://example.com/demo" }, ...configuration.activities.slice(1)] });
  assert.equal(safe.activities[0].link, "https://example.com/demo");
});

test("week setup route accepts no user-controlled captain authority", () => {
  assert.deepEqual(parseRoute("#/week-setup"), { name: "week-setup" });
  assert.equal(parseRoute("#/week-setup/captain/" + key(94)).name, "invalid");
  assert.equal(parseRoute("#/week-setup/30078:captain:week").name, "invalid");
  assert.deepEqual(parseRoute("#/week/4/friday"), { name: "week-day", weekNumber: 4, day: "friday" });
  assert.equal(parseRoute("#/week/4/saturday").name, "invalid");
  assert.equal(parseRoute("#/week/0/monday").name, "invalid");
});

test("week event builder and parser require one manifest-captain canonical configuration", async () => {
  const captainSecret = key(95);
  const slot = {
    cohort_id: "madeira-2026",
    week_number: 3,
    start_date: "2026-01-13",
    end_date: "2026-01-19",
    captain_pubkey: getPublicKey(captainSecret),
    participant_allowlist: [getPublicKey(key(96))],
  };
  const configuration = seedWeekConfiguration(slot, {
    theme: "Canonical configuration",
    public_description: "One complete, captain-owned configuration.",
  });
  const event = await buildWeekConfigurationEvent({ slot, configuration, secretKeyHex: captainSecret, createdAt: 100 });
  assert.deepEqual(event.tags, [["d", weekD(slot)], ["t", "captains-cabin-week"]]);
  assert.equal(await verifyEvent(event), true);
  assert.deepEqual(parseWeekConfigurationEvent(event, slot)?.configuration, configuration);
  await assert.rejects(
    buildWeekConfigurationEvent({ slot, configuration, secretKeyHex: key(97), createdAt: 100 }),
    /assigned captain/,
  );
  await assert.rejects(
    buildWeekConfigurationEvent({ slot, configuration: { ...configuration, week_number: 4 }, secretKeyHex: captainSecret, createdAt: 100 }),
    /manifest slot/,
  );

  const signed = async (changes) => finalizeEvent({
    kind: APP_KIND,
    created_at: 101,
    tags: [["d", weekD(slot)], ["t", "captains-cabin-week"]],
    content: JSON.stringify(configuration),
    ...changes,
  }, captainSecret);
  assert.equal(parseWeekConfigurationEvent(await signed({ kind: APP_KIND + 1 }), slot), null, "kind is fixed");
  assert.equal(parseWeekConfigurationEvent(await signed({ tags: [["d", weekD(slot)], ["d", weekD(slot)], ["t", "captains-cabin-week"]] }), slot), null, "duplicate d tags are rejected");
  assert.equal(parseWeekConfigurationEvent(await signed({ tags: [["d", weekD(slot)], ["t", "wrong-app"]] }), slot), null, "application tag is fixed");
  assert.equal(parseWeekConfigurationEvent(await signed({ content: JSON.stringify({ ...configuration, v: 2 }) }), slot), null, "unsupported version is rejected");
  assert.equal(parseWeekConfigurationEvent(await signed({ content: "{" }), slot), null, "malformed content is rejected");
  assert.equal(parseWeekConfigurationEvent(await signed({ content: "x".repeat(MAX_WEEK_CONFIGURATION_CONTENT_LENGTH + 1) }), slot), null, "oversized content is rejected before parsing");
});
