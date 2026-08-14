# Phase 1: Secure Week Configuration - Context

**Gathered:** 2026-08-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 establishes the cohort-level configuration and the complete captain workflow for preparing a week before participant intake opens. It delivers deterministic week provisioning from cohort dates, captain-to-week assignments, a seeded participant allowlist, editable Tuesday/Wednesday activities, proposal-form configuration, Demo Day timing configuration, preview/readiness behavior, and explicit captain-signed publication of week configuration.

This phase does not deliver proposal submission or encrypted intake, schedule assembly/publication, or archive/cloning behavior. The allowlist is provisioned here so later phases have a canonical input, but participant enforcement begins with Phase 2.

</domain>

<decisions>
## Implementation Decisions

### Cohort Provisioning
- **D-01:** A deployment-time cohort manifest defines the cohort beginning and end, captain `npub` assignments by week, the participant allowlist `npub`s, and a `starting_week` value that defaults to 1. The exact file/environment representation is not prescribed. — **Reversibility:** costly — changing the provisioning contract after launch would affect derived weeks and authorization inputs across later phases.
- **D-02:** The cohort start date anchors consecutive seven-day weeks in `Atlantic/Madeira`, regardless of weekday.
- **D-03:** `starting_week` skips earlier cohort slots while preserving cohort numbering. For example, `starting_week = 3` makes the third derived cohort week the first Cabin-enabled week and keeps its label as Week 3. — **Reversibility:** costly — published week coordinates and captain assignments may depend on this numbering.
- **D-04:** Weeks are pre-provisioned from the manifest rather than freely created. A captain can configure only the week assigned to their `npub`.

### Creation and Publishing
- **D-05:** A captain edits an assigned week locally. The first **Create week** action publishes one complete public configuration in a setup/intake-closed state; no partial shell is published while the form is incomplete.
- **D-06:** Later edits also remain local until the captain reviews them and explicitly selects **Publish changes**, producing one signed configuration revision rather than a relay event per keystroke.
- **D-07:** Published configuration can be edited again through a new local draft; publication is always an intentional captain action.

### Editor Organization
- **D-08:** Use one setup workspace with sections for week details, activities, proposal form, and Demo Day timing, followed by preview and publish controls.
- **D-09:** Activities appear as ordered, collapsible agenda cards grouped under Tuesday and Wednesday, with simple move and edit controls rather than a calendar grid or dense table.
- **D-10:** A Preview mode toggle replaces editing controls with the exact public-facing week view and provides a clear return-to-edit action.
- **D-11:** Show inline validation errors and a section-level readiness checklist. Publish remains disabled until every required configuration item is valid.

### MVP Standard
- **D-12:** Favor the smallest reliable end-to-end implementation. Phase 1 does not need exhaustive flexibility or polish, but its cohort derivation, captain authorization, draft/publish flow, and persisted configuration must work correctly.

### Agent's Discretion
- Choose `.env`, a generated TypeScript module, JSON, or another build-time representation for the cohort manifest, provided the required values are validated before use and no private keys are embedded.
- Choose the exact manifest schema, Nostr event kind/coordinate layout, serialization versioning, and code-module boundaries using the project research and existing repository conventions.
- Choose accessible controls for expanding, reordering, adding, and removing agenda cards while preserving the day-grouped card model.
- Choose exact field copy, visual styling, empty states, and responsive details using existing panel/form components and escaping helpers.
- Choose proposal-form schema locking rules and Demo Day duration bounds using the simplest safe behavior consistent with REQUIREMENTS.md; these areas were intentionally left to research and planning.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product and Phase Scope
- `.planning/PROJECT.md` — product purpose, constraints, validated capabilities, and locked project-level decisions.
- `.planning/REQUIREMENTS.md` — Phase 1 requirements `WEEK-01` through `WEEK-04`, `TIME-01` through `TIME-02`, `FORM-01` through `FORM-03`, and `ACES-02` through `ACES-03`.
- `.planning/ROADMAP.md` — Phase 1 goal, boundary, dependencies, and observable success criteria.

### Research and Existing Architecture
- `.planning/research/SUMMARY.md` — recommended public configuration model, authorization boundaries, schema versioning, timer units, and roadmap implications.
- `.planning/codebase/ARCHITECTURE.md` — application/domain/Nostr/UI boundaries and repository integration pattern.
- `.planning/codebase/CONVENTIONS.md` — TypeScript naming, validation, module, and error-handling conventions.
- `.planning/codebase/STACK.md` — browser-only TypeScript runtime and build constraints.

No separate user-provided external specification or ADR was referenced during discussion.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/App.ts` (`DemoDayApp.#renderCreate`, `#createSession`): current local form-draft to explicit signed publish flow; extend its behavior without keeping the new week model inside the application controller.
- `src/app/App.ts` (`#renderCaptainControls`): existing captain-only control presentation and escaped dynamic option rendering.
- `src/domain/types.ts` (`DemoDaySessionV1`): established versioned, snake_case wire-data convention; new cohort/week/configuration types should be separate and explicitly versioned.
- `src/domain/timer.ts` (`calculateTimer`, `splitPresentationTime`): pure timer calculations currently use module constants; adapt them to validated persisted durations while preserving pure-function behavior.
- `src/nostr/event-builders.ts` and `src/nostr/event-parsers.ts`: paired signed-event builders and strict bounded parsing pattern for new configuration events.
- `src/nostr/repository.ts`: verified ingest, query, publish, pending-retry, and subscriber boundary; UI code must not access relays directly.
- `src/ui/html.ts`: reusable escaped `field`, `textarea`, `button`, panel, and attribute/text helpers for the sectioned editor.

### Established Patterns
- Browser-only vanilla TypeScript with hash routes, full-root rerenders, delegated event handlers, and private application draft state.
- Pure domain functions and versioned interfaces are separated from Nostr codecs and repository orchestration.
- Signed Nostr events establish authorship; strict parsers reject malformed state before it reaches the UI.
- User-visible errors are stored in application state and rendered safely; all dynamic markup passes through escaping helpers.

### Integration Points
- Add validated cohort bootstrap configuration near the existing `src/config/` boundary and wire it through the build/startup path.
- Add pure cohort-week derivation, week configuration, proposal-form schema, validation, and timer-config modules under `src/domain/`.
- Add corresponding signed configuration builders/parsers and repository queries under `src/nostr/`.
- Extend `src/app/router.ts` and `DemoDayApp` with assigned-week setup, edit, and preview routes while keeping relay access behind `NostrRepository`.

</code_context>

<specifics>
## Specific Ideas

- The site is built near the beginning of a cohort, with its date range and access roster supplied at deployment.
- A cohort can begin using Captain's Cabin after Week 1 without renumbering later weeks.
- The captain workspace visibly groups Tuesday talks and Wednesday workshops.
- New Demo Days default to 6 minutes presenting and 2 minutes of questions, but the same controls must support a 60-second presentation with 2 minutes of questions.
- “This is an MVP; it doesn't need to be perfect, but it does need to work.” Use this to resolve remaining tradeoffs toward reliability and simplicity.

</specifics>

<deferred>
## Deferred Ideas

- Participant proposal submission, amendment, whitelist enforcement, and encrypted captain delivery — Phase 2.
- Private schedule assembly and explicit public schedule projection — Phase 3.
- Read-only archive and configuration-only cloning — Phase 4.
- Participant availability, publication history, advanced forms, and expanded event operations — v2+.

</deferred>

---

*Phase: 1-Secure Week Configuration*
*Context gathered: 2026-08-14*
