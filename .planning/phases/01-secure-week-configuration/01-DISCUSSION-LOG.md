# Phase 1: Secure Week Configuration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-14
**Phase:** 1-Secure Week Configuration
**Areas discussed:** Creation and saving, Editor organization

---

## Creation and Saving

### Initial publication

| Option | Description | Selected |
|--------|-------------|----------|
| Local draft | Keep edits local until **Create week** publishes one complete public configuration in setup/intake-closed state. | ✓ |
| Empty public shell | Publish a minimal week immediately, then publish changes as the captain configures it. | |
| Wait for intake | Keep the entire week local until participant intake opens. | |

**User's choice:** Local draft until **Create week** publishes a complete public setup.

**Notes:** The later cohort-provisioning clarification changed “create an arbitrary week” into “configure an assigned, pre-provisioned week slot.” The first publish still creates that slot's complete public configuration.

### Cohort provisioning

| Option | Description | Selected |
|--------|-------------|----------|
| Deployment manifest | Define cohort start/end, captain assignments, participant allowlist, and starting-week offset at build or deployment time. | ✓ |
| Captain-created weeks | Let captains freely create and date week records after deployment. | |
| Relay-discovered cohort | Derive the cohort and access roster entirely from existing Nostr events. | |

**User's choice:** A deployment-time configuration, such as environment-backed configuration, defines the cohort beginning and end. The app infers week slots and numbers, pre-gates captains to assigned weeks, and seeds the participant `npub` allowlist.

**Notes:** The site should normally be built near the beginning of the cohort. The representation is intentionally left open so planning can choose the smallest reliable implementation.

### Starting-week offset

| Option | Description | Selected |
|--------|-------------|----------|
| Skip and preserve numbering | Skip earlier cohort slots, but keep their original cohort week numbers. | ✓ |
| Relabel the first enabled week | Treat the first enabled slot as Week 1 regardless of its cohort position. | |
| Separate offsets | Configure skipped slots and displayed week number independently. | |

**User's choice:** Skip earlier cohort weeks while preserving cohort numbering; `starting_week` defaults to 1.

**Notes:** With `starting_week = 3`, the first Cabin-enabled slot is the third derived cohort week and remains labeled Week 3.

### Week boundaries

| Option | Description | Selected |
|--------|-------------|----------|
| Cohort-anchored weeks | The cohort start date anchors consecutive seven-day weeks. | ✓ |
| Calendar weeks | Use Monday-through-Sunday calendar weeks, allowing partial boundary weeks. | |
| Restricted cohort dates | Require the cohort to begin on Monday and end on Sunday. | |

**User's choice:** Cohort start anchors consecutive seven-day weeks, regardless of weekday.

**Notes:** Date and time interpretation is fixed to `Atlantic/Madeira` for this MVP.

### Saving later edits

| Option | Description | Selected |
|--------|-------------|----------|
| Draft then publish | Keep changes local until **Publish changes** emits one signed configuration revision. | ✓ |
| Section publishing | Publish each editor section independently. | |
| Relay autosave | Publish every field change immediately to Nostr. | |

**User's choice:** Local draft followed by one explicit, reviewed publication.

**Notes:** A published configuration can be reopened for editing, but editing never produces a relay event per keystroke.

---

## Editor Organization

### Workspace structure

| Option | Description | Selected |
|--------|-------------|----------|
| One setup workspace | Show week details, activities, proposal form, and Demo Day timing as sections on one screen. | ✓ |
| Guided wizard | Lead the captain through one required step at a time. | |
| Separate pages | Give every configuration section its own route and save flow. | |

**User's choice:** One sectioned setup workspace, followed by preview and publish controls.

**Notes:** This keeps the MVP easy to scan and avoids extra navigation state.

### Activity editing

| Option | Description | Selected |
|--------|-------------|----------|
| Day-grouped agenda cards | Group ordered, collapsible activity cards beneath Tuesday and Wednesday with simple move/edit controls. | ✓ |
| Calendar canvas | Place activities on a visual, drag-and-drop timeline. | |
| Editable table | Show all activities in a compact row-and-column editor. | |

**User's choice:** Day-grouped agenda cards.

**Notes:** Tuesday talks and Wednesday workshops are the primary grouping; the interface only needs reliable ordering and editing, not a polished scheduling canvas.

### Preview

| Option | Description | Selected |
|--------|-------------|----------|
| Public-view toggle | Replace editor controls with the exact public-facing view and provide a return-to-edit action. | ✓ |
| Side-by-side preview | Keep a live public preview visible beside the editor. | |
| Summary only | Show a compact configuration summary until publication. | |

**User's choice:** Full public-view Preview mode toggle.

**Notes:** Preview should make the publish result understandable without adding a second continuously synchronized layout.

### Validation and readiness

| Option | Description | Selected |
|--------|-------------|----------|
| Inline validation and checklist | Show field errors plus section readiness; disable Publish until all required data is valid. | ✓ |
| Warning confirmation | Permit incomplete publication after a warning and confirmation. | |
| Validate on publish | Defer all validation feedback until the captain selects Publish. | |

**User's choice:** Inline errors, a readiness checklist, and disabled Publish until configuration is valid.

**Notes:** The governing product standard is: this is an MVP, so it does not need to be perfect, but it does need to work.

---

## the agent's Discretion

- The exact build-time cohort manifest representation and validation boundary.
- The Nostr configuration kind, coordinate, serialization version, and module boundaries.
- Proposal-form schema locking rules and sensible Demo Day duration bounds.
- Accessible add, remove, expand, collapse, and reorder controls within the agreed card model.
- Exact field copy, styling, empty states, and responsive behavior.

## Deferred Ideas

- Participant proposal submission, amendment, allowlist enforcement, and encrypted captain delivery — Phase 2.
- Private schedule assembly and explicit public schedule publication — Phase 3.
- Read-only archive and cloning a previous configuration — Phase 4.
- Participant availability, publication history, advanced forms, and broader event operations — v2 or later.
