---
phase: 01-secure-week-configuration
plan: 04
subsystem: nostr-configuration
tags: [typescript, nostr, kind-30078, authorization, revisions, testing]
requires:
  - phase: 01-03
    provides: Captain workspace, local draft states, and public preview contracts
provides:
  - Canonical manifest-captain parsing for accepted week state
  - Deliberate, stale-safe week create/revision coordination with exact read-back
  - Signed pending-event retry and hostile-relay regression coverage
affects: [private-proposals, schedule-publication, archive]
tech-stack:
  added: []
  patterns:
    - Semantic manifest authorization layered on cryptographic event verification
    - Refresh-compare-sign-publish-read-back revision lifecycle
    - Retain and retry the exact signed pending week event
key-files:
  created: []
  modified:
    - src/nostr/event-parsers.ts
    - src/nostr/repository.ts
    - src/app/App.ts
    - tests/core.test.mjs
    - tests/integration.test.mjs
key-decisions:
  - "Reject ambiguous duplicate week coordinate or application tags before accepting event content."
  - "Select accepted week state only from manifest-authorized semantic candidates, not a generic coordinate winner."
  - "Retry a queued signed week event before permitting another deliberate signing attempt."
patterns-established:
  - "Read-back must match the event ID just published before the retained draft base advances."
  - "Editor input and mutation handlers remain relay-write-free; publication is isolated to the explicit submit path."
requirements-completed: [ACES-02, ACES-03]
coverage:
  - id: D1
    description: "Canonical builder/parser/repository acceptance rejects forged, malformed, wrong-tag, duplicate-tag, and unauthorized week events."
    requirement: ACES-03
    verification:
      - kind: unit
        ref: "tests/core.test.mjs#week event builder and parser require one manifest-captain canonical configuration"
        status: pass
      - kind: integration
        ref: "tests/integration.test.mjs#repository retains the latest accepted week when hostile replacements arrive"
        status: pass
    human_judgment: false
  - id: D2
    description: "Explicit create/revision publication is singular, stale-safe, monotonic, retryable, and preserves validated timing values."
    requirement: ACES-02
    verification:
      - kind: integration
        ref: "tests/integration.test.mjs#deliberate week publications are singular, monotonic, exact round trips, and retry queued events"
        status: pass
      - kind: other
        ref: "npm run verify && npm run build"
        status: pass
    human_judgment: false
duration: 2min
completed: 2026-08-14
status: complete
---

# Phase 01 Plan 04: Signed Revision Hardening Summary

**Manifest-authorized, canonical Nostr week revisions with stale-base protection, exact verified read-back, and retry-safe signed outbox delivery.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-08-14T11:48:09Z
- **Completed:** 2026-08-14T11:49:43Z
- **Tasks:** 2/2
- **Files modified:** 5

## Accomplishments

- Enforced a single canonical `d` coordinate and application tag before a signed event can become accepted week configuration.
- Kept generic verified relay events separate from accepted week state, so newer malformed or wrong-tag events cannot displace a valid manifest-captain configuration.
- Added deliberate create/revision coordination that refreshes the exact coordinate, rejects stale bases before signing, confirms the exact event on read-back, and advances the local base only after confirmation.
- Preserved signed failed publications for retry through the same explicit action and kept editor mutations free of relay writes.
- Added security and lifecycle regressions for hostile events, signature/hash failures, round trips, monotonic timestamps, exact publication counts, and queued retry behavior.

## Task Commits

1. **Task 1: Harden signed event construction and accepted repository state** — `114971e`
2. **Task 2: Coordinate deliberate revisions and prove zero implicit publications** — `f38ce90`

## Files Created/Modified

- `src/nostr/event-parsers.ts` — rejects ambiguous or noncanonical week event tags.
- `src/nostr/repository.ts` — chooses only accepted semantic week candidates and exposes a pending exact-week event for retry.
- `src/app/App.ts` — handles stale base comparisons, exact read-back, retry-safe publication, and user-safe errors.
- `tests/core.test.mjs` — adds canonical builder/parser authorization and bounds coverage.
- `tests/integration.test.mjs` — proves accepted-state resilience, singular publication, timing round trips, retry, and zero implicit publication paths.

## Decisions Made

- Accepted state is derived by semantic parser validation against the provisioned manifest after canonical event verification.
- A retry never creates a second replacement while a signed event for the same week remains queued.
- The loaded base event advances only when repository read-back returns the exact event ID just published.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Scoped the relay-write regression to the week publication boundary**
- **Found during:** Task 2 verification
- **Issue:** The initial static assertion counted legitimate existing Demo Day publication paths outside week configuration.
- **Fix:** Limited the assertion to `#publishWeek`, while retaining explicit checks that input and editor mutation handlers never publish.
- **Files modified:** `tests/integration.test.mjs`
- **Verification:** `npm run verify`
- **Commit:** `f38ce90`

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

Private proposal delivery can rely on the accepted week configuration being cryptographically verified, manifest-authorized, canonical, and retry-safe.

## Self-Check: PASSED

- All five modified source and test files exist.
- Task commits `114971e` and `f38ce90` exist.
- `npm run verify` passed with 35 tests; `npm run build` passed.
