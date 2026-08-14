---
phase: 01-secure-week-configuration
plan: 01
subsystem: nostr-configuration
tags: [nostr, kind-30078, week-configuration, authorization, validation]
requires: []
provides:
  - Manifest-derived, captain-bound weekly configuration coordinates
  - Signed, verified week configuration publication and read-back
  - Bounded parser and stale-draft protection for week revisions
affects: [week-editor, private-proposals, schedule-publication, archive]
tech-stack:
  added: []
  patterns:
    - Deterministic manifest-derived Nostr coordinate
    - Draft base-event comparison before deliberate replacement publication
key-files:
  created:
    - src/config/cohort.ts
    - src/domain/cohort.ts
    - src/domain/week.ts
    - src/domain/authorization.ts
  modified:
    - src/nostr/event-builders.ts
    - src/nostr/event-parsers.ts
    - src/nostr/repository.ts
    - src/app/App.ts
    - tests/integration.test.mjs
key-decisions:
  - "Use manifest-derived kind 30078 coordinates and captain identity at both signing and read boundaries."
  - "Keep allowlists in public provisioning data but exclude them from signed public week configuration content."
  - "Compare a retained local base event ID to a freshly refreshed coordinate before publishing a revision."
patterns-established:
  - "Week state is accepted only after cryptographic verification plus manifest-bound semantic parsing."
  - "Public configuration parsers reject unknown fields, oversized content, duplicate IDs, and invalid bounded values."
requirements-completed: [WEEK-01, WEEK-04, ACES-02, ACES-03]
coverage:
  - id: D1
    description: "Assigned captain publishes one complete template-seeded week and reads the verified configuration back."
    requirement: WEEK-01
    verification:
      - kind: integration
        ref: "tests/integration.test.mjs#manifest-assigned captain publishes and reads a complete week configuration"
        status: pass
    human_judgment: false
  - id: D2
    description: "Manifest-bound captain authorization rejects invalid configuration inputs and exposes stale revision bases."
    requirement: ACES-02
    verification:
      - kind: integration
        ref: "tests/integration.test.mjs#week configuration rejects invalid boundaries and detects a stale revision base"
        status: pass
    human_judgment: false
duration: 6min
completed: 2026-08-14
status: complete
---

# Phase 01 Plan 01: Manifest-bound week publication Summary

**A captain can edit, sign, publish, and verified-read a deterministic Madeira week configuration, with bounded payloads and stale-draft rejection.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-14T11:25:41Z
- **Completed:** 2026-08-14T11:31:39Z
- **Tasks:** 2/2
- **Files modified:** 9

## Accomplishments

- Added public cohort-manifest validation, deterministic full-week provisioning, and captain-owned kind 30078 coordinates.
- Added complete Tuesday/Wednesday week seeds, semantic author/coordinate validation, signed publication, and verified repository read-back.
- Bound configuration parsing and retained the original draft base so refreshed remote revisions block stale overwrites before signing.

## Task Commits

1. **Task 1: Publish and read one manifest-assigned captain week end to end** - `4871ce1`, `4e652d4` (test, feat)
2. **Task 2: Bound manifest and configuration parsing and reject stale revisions** - `4e276c6`, `5889cb7` (test, feat)

## Files Created/Modified

- `src/config/cohort.ts` - Deployment-visible public cohort manifest.
- `src/domain/cohort.ts` - Manifest validation and deterministic weekly slots.
- `src/domain/week.ts` - Bounded complete week configuration codec and stable seed data.
- `src/domain/authorization.ts` - Shared captain-assignment predicate.
- `src/nostr/event-builders.ts` - Captain-authorized week event builder.
- `src/nostr/event-parsers.ts` - Bounded semantic week-event parser.
- `src/nostr/repository.ts` - Verified week lookup and refreshed read-back.
- `src/app/App.ts` - Deliberate week publication with retained draft base ID.
- `tests/integration.test.mjs` - End-to-end publication and boundary/revision coverage.

## Decisions Made

- Manifest values are parsed as untrusted data; they derive both the author and exact coordinate used on every week read and write.
- The public signed payload deliberately omits participant allowlists and any private proposal state.
- A stale draft keeps its local edits and blocks signing until the captain reloads and reapplies them.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected strict TypeScript narrowing in Task 1 parsing code**
- **Found during:** Task 2 verification
- **Issue:** Newly introduced manifest and configuration validators did not narrow `unknown` values sufficiently under strict TypeScript.
- **Fix:** Added explicit primitive guards and typed week derivation.
- **Files modified:** `src/domain/cohort.ts`, `src/domain/week.ts`
- **Verification:** `npm run verify`
- **Committed in:** `5889cb7`

**2. [Rule 2 - Missing critical functionality] Enforced public event content-size limits before JSON parsing**
- **Found during:** Task 2 hardening
- **Issue:** Count and field bounds alone did not prevent oversized relay event content from being parsed.
- **Fix:** Added a 32 KiB configuration-content limit at the event parser boundary and rejected unknown configuration fields.
- **Files modified:** `src/domain/week.ts`, `src/nostr/event-parsers.ts`
- **Verification:** `npm run verify`
- **Committed in:** `5889cb7`

---

**Total deviations:** 2 auto-fixed (1 Rule 1, 1 Rule 2).
**Impact on plan:** Both fixes were required for strict compilation and bounded relay-input handling; no scope expansion occurred.

## Issues Encountered

- `npm ci` had previously been blocked by locked dependencies; the user approved restoration and the resumed verification completed with zero vulnerabilities.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The next editor plan can build on a verified, manifest-bound configuration draft and persistence boundary.
- The later focused hardening plan retains ownership of the exhaustive forged-event and authorization matrix.

## Self-Check: PASSED

---
*Phase: 01-secure-week-configuration*
*Completed: 2026-08-14*
