import test from "node:test";
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";

import {
  finalizeEvent,
  generateSecretKeyHex,
  getPublicKey,
  sha256,
  verifyEvent,
} from "../dist/assets/nostr/crypto.js";
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
  copyProfileToEphemeralKey,
  createPresenterZapRequest,
} from "../dist/assets/nostr/event-builders.js";
import {
  parseParticipantEntryEvent,
  parseSessionEvent,
} from "../dist/assets/nostr/event-parsers.js";
import {
  calculateTimer,
  formatTimer,
  splitPresentationTime,
} from "../dist/assets/domain/timer.js";
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
import {
  APP_KIND,
  DEFAULT_RELAYS,
  PRESENTATION_MS,
  QUESTIONS_MS,
} from "../dist/assets/config/relays.js";

const key = (number) => number.toString(16).padStart(64, "0");
const sessionD = "sedd-session:0123456789abcdef0123456789abcdef";

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
