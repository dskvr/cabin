import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { APP_KIND } from "../dist/assets/config/relays.js";
import { parseCohortManifest, deriveProvisionedWeeks, weekD } from "../dist/assets/domain/cohort.js";
import { parseWeekConfiguration, removeActivity, removeProposalField, seedWeekConfiguration } from "../dist/assets/domain/week.js";
import { npubEncode } from "../dist/assets/nostr/bech32.js";
import { calculateElo, rankElo } from "../dist/assets/domain/elo.js";
import { buildExport } from "../dist/assets/domain/export.js";
import { buildEntryEvent, buildSessionEvent, buildWeekConfigurationEvent, copyProfileToEphemeralKey } from "../dist/assets/nostr/event-builders.js";
import { parseParticipantEntryEvent } from "../dist/assets/nostr/event-parsers.js";
import { finalizeEvent, getPublicKey } from "../dist/assets/nostr/crypto.js";
import { NostrRepository } from "../dist/assets/nostr/repository.js";
import { InMemoryTestTransport } from "../dist/assets/nostr/transport.js";
import { nextCreatedAt } from "../dist/assets/domain/utils.js";
import { publicWeekPreview } from "../dist/assets/ui/html.js";

const key = (number) => number.toString(16).padStart(64, "0");
const sessionD = "sedd-session:fedcba9876543210fedcba9876543210";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
async function waitFor(predicate, message, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

function makeState(overrides = {}) {
  return {
    v: 1,
    type: "session",
    name: "Integration Demo Day",
    created_at_ms: 1_780_000_000_000,
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

function makeEntry({ realPubkey, sourceId, name, ranking = [], feedback = {}, updatedAt = 1_780_000_001_000 }) {
  return {
    v: 1,
    type: "entry",
    real_pubkey: realPubkey,
    source_profile_event_id: sourceId,
    source_profile_relay: "wss://memory.test",
    demo: {
      name,
      description: `${name} demonstrates deterministic state over Nostr.`,
      link: `https://example.com/${name.toLowerCase().replaceAll(" ", "-")}`,
    },
    ranking,
    feedback,
    updated_at_ms: updatedAt,
  };
}

test("manifest-assigned captain publishes and reads a complete week configuration", async () => {
  const captainSecret = key(71);
  const captainPubkey = getPublicKey(captainSecret);
  const manifest = parseCohortManifest({
    v: 1,
    cohort_id: "madeira-2026",
    start_date: "2026-01-07",
    end_date: "2026-02-03",
    starting_week: 3,
    captains: [{ week_number: 3, npub: npubEncode(captainPubkey) }],
    participant_allowlist: [npubEncode(getPublicKey(key(72)))],
  });
  assert.ok(manifest, "valid deployment manifest is accepted");
  const [slot] = deriveProvisionedWeeks(manifest);
  assert.ok(slot);
  assert.equal(slot.week_number, 3);

  const draft = seedWeekConfiguration(slot, { theme: "Nostr in Madeira", public_description: "A signed, intake-closed week." });
  const event = await buildWeekConfigurationEvent({ slot, configuration: draft, secretKeyHex: captainSecret, createdAt: 100 });
  const repository = new NostrRepository(new InMemoryTestTransport());
  await repository.publish(event);
  await repository.refreshWeek(slot);
  const loaded = repository.getWeek(slot);
  assert.ok(loaded, "repository returns only the verified manifest-bound configuration");
  assert.equal(loaded.configuration.theme, "Nostr in Madeira");
  assert.equal(loaded.configuration.public_description, "A signed, intake-closed week.");
  assert.equal(loaded.configuration.intake_open, false);
  assert.equal(repository.getWeek({ ...slot, captain_pubkey: getPublicKey(key(73)) }), null, "wrong-author coordinates cannot read the state");
});

test("week configuration rejects invalid boundaries and detects a stale revision base", async () => {
  const captainSecret = key(74);
  const captainPubkey = getPublicKey(captainSecret);
  const participantPubkey = getPublicKey(key(75));
  const manifestValue = {
    v: 1,
    cohort_id: "madeira-2026",
    start_date: "2026-01-07",
    end_date: "2026-02-03",
    starting_week: 3,
    captains: [{ week_number: 3, npub: npubEncode(captainPubkey) }],
    participant_allowlist: [npubEncode(participantPubkey)],
  };
  const manifest = parseCohortManifest(manifestValue);
  assert.ok(manifest);
  assert.equal(parseCohortManifest({ ...manifestValue, end_date: "2026-02-30" }), null, "invalid calendar dates fail closed");
  assert.equal(parseCohortManifest({ ...manifestValue, participant_allowlist: [npubEncode(participantPubkey), npubEncode(participantPubkey)] }), null, "duplicate allowlist entries fail closed");

  const [slot] = deriveProvisionedWeeks(manifest);
  assert.ok(slot);
  const initial = seedWeekConfiguration(slot, { theme: "Nostr in Madeira", public_description: "A signed, intake-closed week." });
  assert.equal(weekD(slot), weekD(deriveProvisionedWeeks(manifest)[0]), "derivation has a stable coordinate");
  assert.deepEqual(seedWeekConfiguration(slot, initial), seedWeekConfiguration(slot, initial), "seeding has stable IDs");
  assert.equal(parseWeekConfiguration({ ...initial, theme: "x".repeat(121) }), null, "overlong themes fail closed");
  assert.equal(parseWeekConfiguration({ ...initial, activities: [...initial.activities, initial.activities[0]] }), null, "duplicate activity IDs fail closed");
  assert.equal(parseWeekConfiguration({ ...initial, extra: "x".repeat(40_000) }), null, "oversized unknown payload fields fail closed");

  const transport = new InMemoryTestTransport();
  const repository = new NostrRepository(transport);
  const first = await buildWeekConfigurationEvent({ slot, configuration: initial, secretKeyHex: captainSecret, createdAt: 100 });
  await repository.publish(first);
  const loaded = await repository.refreshWeek(slot);
  assert.equal(loaded?.event.id, first.id);

  const replacement = await buildWeekConfigurationEvent({
    slot,
    configuration: { ...initial, theme: "Changed elsewhere", base_event_id: first.id },
    secretKeyHex: captainSecret,
    createdAt: nextCreatedAt(first.created_at),
  });
  assert.ok(replacement.created_at > first.created_at, "revisions use a monotonic timestamp");
  await repository.publish(replacement);
  const latest = await repository.refreshWeek(slot);
  assert.notEqual(latest?.event.id, loaded?.event.id, "a changed relay base is visible before a revision signs");
  assert.equal(initial.base_event_id, null, "a stale local draft retains its original base rather than adopting the remote revision");
});

test("activity and field removal remain local until an explicit signed publication", () => {
  const slot = { cohort_id: "madeira-2026", week_number: 3, start_date: "2026-01-13", end_date: "2026-01-19", captain_pubkey: key(80) };
  const draft = seedWeekConfiguration(slot, { theme: "Nostr in Madeira", public_description: "A local unpublished draft." });
  const activity = draft.activities[0];
  const field = draft.proposal_fields[0];
  assert.ok(activity && field);
  const answers = { [field.id]: "Cabin maps" };
  const cancelled = structuredClone(draft);
  assert.deepEqual(cancelled, draft, "cancelling destructive confirmation retains the exact draft");
  const afterActivity = removeActivity(draft, activity.id);
  const afterField = removeProposalField(afterActivity, field.id);
  assert.equal(afterField.activities.some((item) => item.id === activity.id), false);
  assert.equal(afterField.proposal_fields.some((item) => item.id === field.id), false);
  assert.equal(answers[field.id], "Cabin maps", "unaffected local answer state is not rewritten by removal");
  assert.equal(parseWeekConfiguration(afterField)?.base_event_id, null, "local destructive mutations emit no relay publication");
});

test("public preview renders only the escaped public configuration projection", () => {
  const markup = publicWeekPreview({
    theme: "<img src=x onerror=alert(1)>",
    public_description: "<script>alert(1)</script>",
    timezone: "Atlantic/Madeira",
    activities: [{ day: "tuesday", name: "<b>Talk</b>", date: "2026-01-13", starts_at: "18:00", ends_at: "19:00", location: "<em>Harbour</em>", link: "https://example.com/demo" }],
    proposal_fields: [{ label: "<svg onload=alert(1)>", required: true }],
    presentation_minutes: 6,
    question_minutes: 2,
  });
  assert.match(markup, /Public week preview/);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(markup, /href="https:\/\/example\.com\/demo"/);
  assert.doesNotMatch(markup, /participant_allowlist|base_event_id|proposal-submission/i);
  assert.doesNotMatch(markup, /<script>|<svg onload/);
});

test("week workspace ships every loading, error, retry, accessibility, and responsive state contract", () => {
  const app = readFileSync(new URL("../dist/assets/app/App.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

  for (const copy of [
    "Loading week configuration…",
    "Loading preview…",
    "This identity is not assigned a week to configure.",
    "Changes saved locally",
    "We couldn't publish this week. Check your Nostr connection and signing identity, then try again.",
    "Try again",
    "Week published. Intake remains closed.",
    "Needs attention",
  ]) assert.match(app, new RegExp(copy.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
  assert.match(app, /aria-describedby/);
  assert.match(app, /aria-live="polite"/);
  assert.match(app, /focusWeekInvalid/);
  assert.match(css, /@media \(max-width: 660px\)/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /min-height: 44px/);
});

test("multi-client captain, participant, display-state, ranking, closure, and export flow", async () => {
  const transport = new InMemoryTestTransport();
  const captainRepository = new NostrRepository(transport);
  const observerRepository = new NostrRepository(transport);
  captainRepository.start();
  observerRepository.start();

  const people = [
    { name: "Alpha", ephemeralSecret: key(31), realSecret: key(41) },
    { name: "Beta", ephemeralSecret: key(32), realSecret: key(42) },
    { name: "Gamma", ephemeralSecret: key(33), realSecret: key(43) },
  ].map((person) => ({
    ...person,
    ephemeralPubkey: getPublicKey(person.ephemeralSecret),
    realPubkey: getPublicKey(person.realSecret),
  }));
  const [captain, beta, gamma] = people;
  assert.ok(captain && beta && gamma);

  const sourceProfiles = [];
  const copiedProfiles = [];
  for (const person of people) {
    const source = await finalizeEvent({
      kind: 0,
      created_at: 50,
      tags: [["source", person.name]],
      content: JSON.stringify({
        display_name: `${person.name} Presenter`,
        about: `${person.name} profile`,
        ...(person.name === "Beta" ? { lud16: "beta@example.com" } : {}),
        custom_field: { retained: true },
      }),
    }, person.realSecret);
    const copied = await copyProfileToEphemeralKey({
      source,
      secretKeyHex: person.ephemeralSecret,
      createdAt: 51,
    });
    sourceProfiles.push(source);
    copiedProfiles.push(copied);
    await captainRepository.publish(copied);
  }

  const sessionAddress = `${APP_KIND}:${captain.ephemeralPubkey}:${sessionD}`;
  let state = makeState();
  let createdAt = 100;
  let sessionEvent = await buildSessionEvent({
    sessionD,
    state,
    secretKeyHex: captain.ephemeralSecret,
    createdAt,
  });
  await captainRepository.publish(sessionEvent);

  let parsedEntries = [];
  for (let index = 0; index < people.length; index += 1) {
    const person = people[index];
    const source = sourceProfiles[index];
    assert.ok(person && source);
    const event = await buildEntryEvent({
      sessionAddress,
      sessionD,
      entry: makeEntry({ realPubkey: person.realPubkey, sourceId: source.id, name: `${person.name} Project` }),
      profile: JSON.parse(source.content),
      secretKeyHex: person.ephemeralSecret,
      createdAt: 100,
    });
    await captainRepository.publish(event);
    const parsed = parseParticipantEntryEvent(event, sessionAddress);
    assert.ok(parsed);
    parsedEntries.push(parsed);
  }
  await waitFor(() => observerRepository.activeSessions().length === 1 && observerRepository.entriesForSession(sessionAddress).length === 3, "observer did not discover initial session state");

  assert.equal(observerRepository.activeSessions().length, 1, "another client discovers the captain session");
  assert.equal(observerRepository.entriesForSession(sessionAddress).length, 3, "participant count is derived from entry coordinates");
  assert.equal((await observerRepository.ensureProfile(captain.ephemeralPubkey))?.content, copiedProfiles[0]?.content);

  const publishState = async (nextState) => {
    state = nextState;
    createdAt += 1;
    sessionEvent = await buildSessionEvent({
      sessionD,
      state,
      secretKeyHex: captain.ephemeralSecret,
      createdAt,
    });
    await captainRepository.publish(sessionEvent);
    await waitFor(() => observerRepository.sessions().some((item) => item.address === sessionAddress && item.event.id === sessionEvent.id), `observer did not ingest session replacement ${createdAt}`);
  };

  await publishState({ ...state, current_demo_pubkey: captain.ephemeralPubkey, timer_started_at_ms: null });
  assert.equal(observerRepository.activeSessions()[0]?.state.current_demo_pubkey, captain.ephemeralPubkey, "GO propagates to every client");

  await publishState({ ...state, timer_started_at_ms: 1_000_000 });
  assert.equal(observerRepository.activeSessions()[0]?.state.timer_started_at_ms, 1_000_000, "one captain timestamp starts the timer");

  const runAlpha = { pubkey: captain.ephemeralPubkey, started_at_ms: 1_000_000, finished_at_ms: 1_361_000 };
  await publishState({ ...state, current_demo_pubkey: null, timer_started_at_ms: null, presented: [runAlpha] });
  await publishState({ ...state, current_demo_pubkey: beta.ephemeralPubkey, timer_started_at_ms: null });
  await publishState({ ...state, timer_started_at_ms: 2_000_000 });
  const runBeta = { pubkey: beta.ephemeralPubkey, started_at_ms: 2_000_000, finished_at_ms: 2_498_333 };
  await publishState({ ...state, current_demo_pubkey: null, timer_started_at_ms: null, presented: [runAlpha, runBeta] });
  await publishState({ ...state, current_demo_pubkey: gamma.ephemeralPubkey, timer_started_at_ms: null });
  await publishState({ ...state, timer_started_at_ms: 3_000_000 });
  const runGamma = { pubkey: gamma.ephemeralPubkey, started_at_ms: 3_000_000, finished_at_ms: 3_450_000 };
  await publishState({ ...state, current_demo_pubkey: null, timer_started_at_ms: null, presented: [runAlpha, runBeta, runGamma] });

  const rankings = [
    [beta.ephemeralPubkey, gamma.ephemeralPubkey],
    [captain.ephemeralPubkey, gamma.ephemeralPubkey],
    [captain.ephemeralPubkey, beta.ephemeralPubkey],
  ];
  const feedback = [
    { [beta.ephemeralPubkey]: { liked: "Strong relay demo" } },
    { [gamma.ephemeralPubkey]: { liked: "Clear timer" } },
    { [captain.ephemeralPubkey]: { liked: "Useful architecture" } },
  ];
  const latestEntries = [];
  for (let index = 0; index < people.length; index += 1) {
    const person = people[index];
    const source = sourceProfiles[index];
    assert.ok(person && source);
    const event = await buildEntryEvent({
      sessionAddress,
      sessionD,
      entry: makeEntry({
        realPubkey: person.realPubkey,
        sourceId: source.id,
        name: `${person.name} Project`,
        ranking: rankings[index],
        feedback: feedback[index],
        updatedAt: 1_780_000_100_000 + index,
      }),
      profile: JSON.parse(source.content),
      secretKeyHex: person.ephemeralSecret,
      createdAt: 120,
    });
    await captainRepository.publish(event);
    const parsed = parseParticipantEntryEvent(event, sessionAddress);
    assert.ok(parsed);
    latestEntries.push(parsed);
  }
  await waitFor(() => {
    const ids = new Set(observerRepository.entriesForSession(sessionAddress).map((entry) => entry.event.id));
    return latestEntries.every((entry) => ids.has(entry.event.id));
  }, "observer did not ingest latest ranking entries");

  const presentationOrder = state.presented.map((run) => run.pubkey);
  const captainElo = calculateElo(presentationOrder, captainRepository.entriesForSession(sessionAddress));
  const observerElo = calculateElo(presentationOrder, observerRepository.entriesForSession(sessionAddress));
  assert.deepEqual(observerElo, captainElo, "two clients calculate identical live Elo from the same state");
  assert.equal(captainElo.pairs.length, 3);

  const finalElo = rankElo(captainElo.rows);
  await publishState({
    ...state,
    closed_at_ms: 1_780_000_900_000,
    final_elo: finalElo,
    snapshot_entry_ids: latestEntries.map((entry) => entry.event.id),
    snapshot_profile_ids: copiedProfiles.map((profile) => profile.id),
    snapshot_zap_ids: [],
  });

  assert.equal(observerRepository.activeSessions().length, 0, "closed session disappears from active discovery");
  const closedSession = observerRepository.sessions()[0];
  assert.ok(closedSession);
  assert.equal(closedSession.state.closed_at_ms, 1_780_000_900_000);
  assert.deepEqual(closedSession.state.final_elo, finalElo);
  assert.deepEqual(closedSession.state.snapshot_entry_ids, latestEntries.map((entry) => entry.event.id));

  const snapshotEvents = await observerRepository.fetchEventsByIds([
    ...closedSession.state.snapshot_entry_ids,
    ...closedSession.state.snapshot_profile_ids,
  ]);
  assert.equal(snapshotEvents.length, 6, "exact snapshotted entries and profiles are retrievable by ID");

  const profiles = new Map();
  for (const person of people) {
    const profile = await observerRepository.ensureProfile(person.ephemeralPubkey);
    assert.ok(profile);
    profiles.set(person.ephemeralPubkey, profile);
  }
  const exported = buildExport({
    session: closedSession,
    entries: observerRepository.entriesForSession(sessionAddress),
    profiles,
    zapReceipts: [],
    generatedAt: new Date("2026-08-06T20:30:22.123Z"),
  });

  assert.equal(exported.schema, "sedd-export-1");
  assert.equal(exported.totals.participants, 3);
  assert.equal(exported.totals.completed_demos, 3);
  assert.equal(exported.totals.feedback_responses, 3);
  assert.deepEqual(exported.elo.final, finalElo.map((row) => ({
    rank: row.rank,
    demo_owner_ephemeral_pubkey: row.pubkey,
    rating: row.rating,
  })));
  assert.equal(JSON.stringify(exported).includes("secret_key"), false);
  assert.equal(JSON.stringify(exported).includes("nsec1"), false);

  // A display client is read-only by construction: discovery and selected-session state
  // were observed without publishing an entry from observerRepository.
  assert.equal(transport.events().filter((event) => event.kind === APP_KIND && event.pubkey === getPublicKey(key(99))).length, 0);
});
