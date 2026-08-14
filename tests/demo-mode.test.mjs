import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DEMO_CUES, DEMO_DURATION_MS, demoCueAt } from "../dist/assets/app/demo-timeline.js";

test("demo timeline is continuous and finishes at exactly 60 seconds", () => {
  assert.equal(DEMO_DURATION_MS, 60_000);
  assert.equal(DEMO_CUES[0]?.startMs, 0);
  assert.equal(DEMO_CUES.at(-1)?.endMs, DEMO_DURATION_MS);
  assert.equal(DEMO_CUES.at(-1)?.title, "JUST WORKS");

  for (let index = 0; index < DEMO_CUES.length; index += 1) {
    const cue = DEMO_CUES[index];
    assert.ok(cue, `cue ${index} exists`);
    assert.ok(cue.endMs > cue.startMs, `${cue.id} has positive duration`);
    assert.ok(cue.eyebrow && cue.title && cue.description && cue.captainBenefit, `${cue.id} includes its complete text overlay`);
    if (index > 0) assert.equal(cue.startMs, DEMO_CUES[index - 1]?.endMs, `${cue.id} starts exactly when the previous cue ends`);
    assert.equal(demoCueAt(cue.startMs).id, cue.id);
    assert.equal(demoCueAt(cue.endMs - 1).id, cue.id);
  }

  assert.equal(demoCueAt(60_000).id, "finale", "the completed presentation remains on JUST WORKS");
});

test("demo mode is explicitly started and isolated before production transport setup", async () => {
  const [main, demo] = await Promise.all([
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/DemoMode.ts", import.meta.url), "utf8"),
  ]);

  const branch = main.indexOf('searchParams.has("demo")');
  const transport = main.indexOf("new WebSocketNostrTransport()");
  assert.ok(branch >= 0 && transport > branch, "demo branch occurs before the production WebSocket transport is created");
  assert.match(main, /new DemoMode\(root\)\.start\(\)/);
  assert.match(demo, /data-demo-action="start"/);
  assert.match(demo, /Nothing begins until you press start\./);
  assert.doesNotMatch(demo, /NostrRepository|Nip07Signer|buildWeekConfigurationEvent|publish\(/, "tour has no production data or signing dependencies");
});

test("demo tour covers the cohort, captain, participant, live, and archive workflows", () => {
  assert.deepEqual(DEMO_CUES.map((cue) => cue.id), [
    "overview",
    "configure",
    "intake",
    "schedule",
    "demo-day",
    "live",
    "interaction",
    "archive",
    "finale",
  ]);
  assert.equal(DEMO_CUES.every((cue) => cue.captainBenefit.length > 0), true);
});
