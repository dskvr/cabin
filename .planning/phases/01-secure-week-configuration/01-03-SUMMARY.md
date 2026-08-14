---
phase: 01-secure-week-configuration
plan: 03
subsystem: ui
tags: [typescript, nostr, week-configuration, accessibility, responsive-ui]
requires:
  - phase: 01-02
    provides: Editable week configuration, readiness validation, and stable-ID editor state
provides:
  - Explicit allowlisted public week projection and escaped preview rendering
  - Hash-safe assigned-week route with loading, error, retry, publication, and accessibility states
  - Responsive one-column captain workspace with readiness focus navigation
affects: [01-04, private-proposals, schedule-publication]
tech-stack:
  added: []
  patterns: [explicit public projection allowlist, local draft retained through asynchronous view states]
key-files:
  created: []
  modified: [src/domain/week.ts, src/app/router.ts, src/app/App.ts, src/ui/html.ts, public/styles.css, tests/core.test.mjs, tests/integration.test.mjs]
key-decisions:
  - "Construct preview data from a separate explicit allowlist rather than filtering the rich editor model at render time."
  - "Keep captain authority derived from active identity and the provisioning manifest; the setup hash only selects the view."
  - "Render retryable loading and publication failures without clearing the local week draft."
patterns-established:
  - "Public configuration renderers consume PublicWeekProjection only."
  - "Readiness blockers are keyboard-operable buttons that expand and focus the first relevant invalid control."
requirements-completed: [WEEK-01, WEEK-02, WEEK-03, WEEK-04, TIME-01, TIME-02, FORM-01, FORM-02, FORM-03]
coverage:
  - id: D1
    description: "Public week projection and setup route reject private configuration and hash-supplied authority."
    requirement: WEEK-04
    verification:
      - kind: unit
        ref: tests/core.test.mjs#public week projection keeps an exact safe allowlist and normalized public links
        status: pass
      - kind: unit
        ref: tests/core.test.mjs#week setup route accepts no user-controlled captain authority
        status: pass
    human_judgment: false
  - id: D2
    description: "Preview markup safely displays only the permitted agenda, timing, and proposal-field data."
    requirement: WEEK-03
    verification:
      - kind: integration
        ref: tests/integration.test.mjs#public preview renders only the escaped public configuration projection
        status: pass
    human_judgment: false
  - id: D3
    description: "Captain workspace exposes required loading, retry, status, focus, responsive, and accessibility contracts."
    requirement: ACES-02
    verification:
      - kind: integration
        ref: tests/integration.test.mjs#week workspace ships every loading error retry accessibility and responsive state contract
        status: pass
      - kind: other
        ref: npm run build
        status: pass
    human_judgment: false
duration: 4min
completed: 2026-08-14
status: complete
---

# Phase 01 Plan 03: Safe Public Preview and Complete Workspace States Summary

**Allowlisted public week preview with hash-safe setup routing, retryable workspace states, and responsive accessible editor controls.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-08-14T11:40:50Z
- **Completed:** 2026-08-14T11:44:59Z
- **Tasks:** 2/2
- **Files modified:** 7

## Accomplishments

- Added `publicWeekProjection`, which exposes only the public agenda, description, timing, and proposal-field presentation data and normalizes links before rendering.
- Added an assigned-week setup route and atomic preview/return behavior that retains the local draft, expanded cards, and focus target.
- Completed initial loading/retry, publication error/retry, live notices, readiness focus navigation, status, responsive wrapping, and touch-target treatments.

## Task Commits

1. **Task 1: Render the exact public projection and restore the editor atomically** — `8f8b375` (test), `21823fa` (feat)
2. **Task 2: Complete loading, error, responsive, and accessible workspace states** — `e4bb789` (test), `e7923d6` (feat)

## Files Created/Modified

- `src/domain/week.ts` — public allowlisted configuration projection.
- `src/app/router.ts` — route parser for the fixed assigned-week view.
- `src/app/App.ts` — preview, retry, status, publication, and readiness-focus controller states.
- `src/ui/html.ts` — escaped public preview markup.
- `public/styles.css` — one-column, responsive, wrapping, focus, and touch-target styles.
- `tests/core.test.mjs` — projection allowlist and route boundary assertions.
- `tests/integration.test.mjs` — escaped preview and full workspace-state contract assertions.

## Decisions Made

- Used a separate explicit projection rather than exposing the full signed week configuration to preview rendering.
- Kept all route authority server/domain-derived from active identity and manifest assignment.
- Preserved local draft data through load and publish failures so retry never discards captain edits.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved the existing error-alert announcement contract while extending notices**
- **Found during:** Task 2
- **Issue:** Rendering successful publication notices changed the established error alert expression checked by the existing accessibility regression test.
- **Fix:** Kept errors as alert announcements and added polite status announcements only for non-error notices.
- **Files modified:** `src/app/App.ts`
- **Verification:** `npm run verify`
- **Committed in:** `e7923d6`

---

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** Preserved existing accessibility behavior while adding the required publication success notice.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04 can harden signed revision coordination without changing the public projection, presentation, or local-draft retention contracts.

## Self-Check: PASSED

- All seven modified source and test files exist.
- Task commits `8f8b375`, `21823fa`, `e4bb789`, and `e7923d6` exist.
- `npm run verify` passed with 31 tests; `npm run build` passed.
