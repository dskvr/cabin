---
phase: 01-secure-week-configuration
reviewed: 2026-08-14T11:53:54Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/config/cohort.ts
  - src/domain/cohort.ts
  - src/domain/week.ts
  - src/domain/timer.ts
  - src/domain/authorization.ts
  - src/nostr/event-builders.ts
  - src/nostr/event-parsers.ts
  - src/nostr/repository.ts
  - src/app/App.ts
  - src/app/router.ts
  - src/ui/html.ts
  - public/styles.css
  - tests/core.test.mjs
  - tests/integration.test.mjs
findings:
  critical: 3
  warning: 2
  info: 0
  total: 5
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-08-14T11:53:54Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

The week parser, canonical event tags, public projection, and explicit publish boundary are generally structured defensively. The submitted phase is nevertheless not shippable: the checked-in deployment manifest assigns no captain, configured week timings are never used by a Demo Day, and an untrusted relay can permanently poison signature verification for a valid event ID in a running client. The test suite's source-text checks miss the broken end-to-end timing path.

## Critical Issues

### CR-01: The shipped manifest makes the captain workflow unreachable

**File:** `src/config/cohort.ts:1-8`
**Issue:** The only runtime manifest contains an empty `captains` array. `#renderWeekConfiguration()` resolves the current identity exclusively via `weekForCaptain`, so every identity reaches “This identity is not assigned a week to configure” and no one can create or publish a week. The hard-coded cohort also ended on 2026-01-07. This is not a usable deployment-time configuration for the phase goal.
**Fix:** Supply the real current cohort range, `starting_week`, at least one valid captain `npub` assignment, and the intended allowlist through the approved deployment configuration. Add a startup/integration assertion that the shipped manifest parses and resolves a known assigned captain.

### CR-02: Per-week presentation and question settings never affect a Demo Day

**File:** `src/app/App.ts:1436-1457`
**Issue:** `#createSession()` creates the existing free-form session state without a week/configuration coordinate or a duration snapshot. The only timer call sites use `formatTimer(Date.now() - startedAtMs)` with its global 6-minute/2-minute defaults (`src/app/App.ts:764-767` and `src/app/App.ts:2396-2400`). A captain can sign a 1-minute + 2-minute week configuration, but its Demo Day still transitions to questions after six minutes. This violates TIME-02 and the phase success criterion for per-week overrides.
**Fix:** Link a Demo Day to the manifest-derived week (or persist an immutable validated duration snapshot in the session state) when it is created. Resolve that configuration for both initial rendering and periodic timer updates, and pass `{ presentationMs: minutes * 60_000, questionMs: minutes * 60_000 }` to `formatTimer`/`splitPresentationTime`. Cover a live 1+2 session end-to-end.

### CR-03: A forged signature can permanently suppress a legitimate event in the client

**File:** `src/nostr/repository.ts:113-123`
**Issue:** Verification promises are cached solely by `event.id`, including `false` results. A hostile relay can send a copy of a legitimate event ID with an invalid signature before an honest relay delivers the valid signed event. The invalid result is cached; every later valid event with that ID reuses the cached `false` and is rejected for the lifetime of the repository. This enables relay-controlled denial of configuration discovery and stale-revision recovery.
**Fix:** Cache only successful verification results (an ID is safe to reuse only after its hash and signature have both verified), or key negative cache entries by the complete serialized event with a short expiry. Add a regression test that ingests a bad-signature clone first and then accepts the authentic event with the same ID.

## Warnings

### WR-01: Event-size limits are enforced only after expensive untrusted cryptography

**File:** `src/nostr/repository.ts:113-122`
**Issue:** `ingest()` calls `verifyEvent()` before the week parser applies `MAX_WEEK_CONFIGURATION_CONTENT_LENGTH`. The event-shape check accepts unbounded content and tag arrays, so a relay can force JSON serialization, hashing, Schnorr verification, and growth of `#seenOn`/`#validity` for oversized garbage that the parser later rejects. The advertised week-content bound therefore does not protect the browser from untrusted oversized relay messages.
**Fix:** Apply inexpensive universal bounds (content byte length, number of tags, tag elements, and tag-string length) before updating repository maps or calling `verifyEvent`; retain the tighter week-specific limit in the semantic parser. Add an ingest test proving an oversized event is rejected without invoking signature verification or being retained in repository state.

### WR-02: Timing tests validate isolated helpers and source text, not the configured workflow

**File:** `tests/core.test.mjs:602-608`
**Issue:** The tests show that `calculateTimer()` supports optional overrides, while `tests/integration.test.mjs:217-230` only asserts that 1+2 values survive event serialization. Neither test exercises `DemoDayApp` creating/running a session from that week. Consequently the tests pass while CR-02 leaves all UI timers at 6+2.
**Fix:** Add an integration test that mounts the application with an assigned captain and published 1+2 configuration, starts a Demo Day, and asserts the rendered timer changes to QUESTIONS at 60 seconds (including the periodic update path). Prefer behavioral assertions over matching implementation strings in built output.

---

_Reviewed: 2026-08-14T11:53:54Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
