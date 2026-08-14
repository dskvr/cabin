---
phase: 01-secure-week-configuration
plan: 02
subsystem: ui
tags: [typescript, nostr, week-configuration, accessibility, validation]
requires:
  - phase: 01-01
    provides: manifest-bound signed week configuration and draft publication flow
provides:
  - ID-based activity and proposal-field mutations with local-draft validation
  - Per-week Demo Day durations used by timer calculations
  - Ordered accessible week editor cards, readiness state, and local-only removal confirmation
affects: [private-proposals, schedule-publication]
tech-stack:
  added: []
  patterns: [pure ID-based draft mutations, readiness-derived publication gating, escaped full-root card rendering]
key-files:
  created: []
  modified: [src/domain/week.ts, src/domain/timer.ts, src/app/App.ts, src/ui/html.ts, public/styles.css, tests/core.test.mjs, tests/integration.test.mjs]
key-decisions:
  - "Keep activity and field identity immutable while label, order, and requiredness remain editable."
  - "Persist whole-minute timing values and pass their milliseconds into the existing timer functions."
patterns-established:
  - "Destructive editor actions remain local until the existing explicit signed publish action."
requirements-completed: [WEEK-02, WEEK-03, TIME-01, TIME-02, FORM-01, FORM-02, FORM-03]
coverage:
  - id: D1
    description: Ordered activities, bounded Demo Day timing, and publication readiness
    requirement: WEEK-02
    verification:
      - kind: unit
        ref: tests/core.test.mjs#week activities retain stable identities, order, valid timing, and duration boundaries
        status: pass
    human_judgment: false
  - id: D2
    description: Stable proposal fields and ID-keyed answer validation
    requirement: FORM-03
    verification:
      - kind: unit
        ref: tests/core.test.mjs#proposal fields keep answer association through rename, reorder, requiredness, and removal
        status: pass
    human_judgment: false
  - id: D3
    description: Local-only destructive activity and field mutations
    requirement: FORM-01
    verification:
      - kind: integration
        ref: tests/integration.test.mjs#activity and field removal remain local until an explicit signed publication
        status: pass
    human_judgment: false
duration: 6min
completed: 2026-08-14
status: complete
---

# Phase 01 Plan 02: Captain week editor Summary

**Captain-facing week configuration now supports ordered activities, persisted Demo Day timing, stable proposal fields, readiness gating, and explicit local-only destructive edits.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-14T11:32:22Z
- **Completed:** 2026-08-14T11:38:27Z
- **Tasks:** 2/2
- **Files modified:** 7

## Accomplishments

- Added pure, ID-based activity and proposal-field mutation APIs, per-section readiness, URL normalization, whole-minute timing constraints, and stable answer validation.
- Extended the captain workspace with ordered Tuesday and Wednesday cards, proposal-field cards, timing controls, responsive wrapping, readiness feedback, and publication gating.
- Added exact local-draft removal confirmation copy, cancellation/confirmation focus handling, and regression coverage for timing, identity continuity, and no-publication mutations.

## Task Commits

1. **Task 1: Configure ordered activities and per-week Demo Day timing** — `8b523be` (feat)
2. **Task 2: Configure stable proposal fields and actionable readiness** — `b1e407a` (feat)
3. **Follow-up correctness fix: restore focus after local removal** — `4bb5742` (fix)

## Files Created/Modified

- `src/domain/week.ts` — validates and mutates activities, fields, timing, readiness, and ID-keyed answers.
- `src/domain/timer.ts` — accepts persisted presentation and question durations while retaining legacy defaults.
- `src/app/App.ts` — renders and manages the complete local captain week workspace.
- `src/ui/html.ts` — safely associates native field help and error text.
- `public/styles.css` — defines responsive, wrapping editor-card and readiness treatment.
- `tests/core.test.mjs` — covers activity/timing and stable proposal-field invariants.
- `tests/integration.test.mjs` — verifies local-only removal behavior.

## Decisions Made

- Keep activities in the signed wire model's existing `day` groups and preserve all IDs through ordinary edits and moves.
- Gate Create week/Publish changes from pure readiness validation; destructive actions never call the repository.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Restored focus after a local destructive action**
- **Found during:** Task 2
- **Issue:** The full-root re-render had no surviving focus target after cancellation or confirmation.
- **Fix:** Return cancellation focus to the originating removal control; move confirmation focus to a neighboring card control or the add control.
- **Files modified:** `src/app/App.ts`
- **Verification:** `npm run verify`
- **Committed in:** `4bb5742`

---

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** Required accessibility behavior completed without scope expansion.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 2 can reuse the stable proposal-field IDs and `validateProposalAnswers` contract for private participant intake.

## Self-Check: PASSED

- All modified production files exist.
- Task commits `8b523be`, `b1e407a`, and `4bb5742` exist.
- `npm run verify` passed: typecheck and 27 tests.
