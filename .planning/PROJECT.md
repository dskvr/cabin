# Captain's Cabin

## What This Is

Captain's Cabin is the sovereignengineering.io event-operations application for recurring community weeks. It expands the existing Demo Day tool so each captain can shape Tuesday talks and Wednesday workshops to their own theme, timing, intake, and schedule while whitelisted participants interact through Nostr.

The initial release covers configuring a week, privately collecting participant proposals and availability, assembling the schedule, and publishing that schedule publicly. Previous weeks remain available as an archive and can be cloned to seed future weeks.

## Core Value

Each captain can tailor and publish their week without requiring code changes, while participants retain Nostr-native identity and interaction.

## Requirements

### Validated

- ✓ Participation is restricted to an explicit whitelist — existing
- ✓ Captains have elevated privileges over ordinary participants — existing
- ✓ Participant identity and interaction use signed Nostr events and relays — existing
- ✓ The browser application can create and run Demo Day sessions with routed views, timers, displays, and exports — existing

### Active

- [ ] Captains can create a week from Tuesday-talk and Wednesday-workshop templates
- [ ] Captains can add, remove, rename, and reschedule activities within a week
- [ ] Captains can customize standard talk and workshop intake fields, including field names and required status
- [ ] Captains can configure Demo Day presentation and question durations per week, starting from defaults of 6 minutes and 2 minutes
- [ ] Whitelisted participants can privately submit proposals and availability for the active week
- [ ] Captains can review participant submissions and assemble the week schedule
- [ ] Captains can publish a finalized schedule for public viewing
- [ ] Captains can archive completed weeks and clone an earlier week as the basis for a new one

### Out of Scope

- Fully arbitrary event construction with no Tuesday/Wednesday templates — v1 should preserve useful structure while allowing captains to adapt it
- New live moderation and session-operator tooling beyond the existing Demo Day timer — deferred until scheduling and publication are proven
- Reminders, attendance tracking, and post-event feedback — deferred beyond the first milestone
- Public participant proposals, availability, or personal details — private intake is visible only to the captain

## Context

The repository currently implements a browser-only Demo Day application in vanilla TypeScript. `DemoDayApp` coordinates routes, rendering, session state, timers, and participant actions; domain logic lives in `src/domain/`; Nostr identity, relay transport, event verification, and repository behavior live in `src/nostr/`.

The application has no server database or authentication session layer. Signed Nostr events are published to configured relays, with local browser storage used for identity, pending publications, and selected state. The new scheduling and intake model must extend this architecture without weakening event verification, whitelist enforcement, captain authorization, or safe HTML rendering.

Today the codebase is narrowly shaped around Demo Day. The product direction is broader recurring-week operations: Tuesday talks and Wednesday workshops are starting templates, not hard-coded schedules. Captains frequently change times, themes, activity names, and intake details, so those choices must be represented as data rather than source changes.

The existing Demo Day timer remains part of the product. New weeks default to 6 minutes for presenting and 2 minutes for questions, while captains can override both values for a particular week, including formats such as a 60-second demo followed by 2 minutes of questions.

## Constraints

- **Identity and interaction**: Continue using Nostr for participant identity and application interactions — this is a defining property of the product
- **Authorization**: Only whitelisted participants may submit or interact, and captain-only operations must be enforced independently of the UI — existing trust boundaries must remain intact
- **Privacy**: Published schedules are public, while proposals, availability, and participant details are captain-only — Nostr event design must account for relay visibility
- **Configurability**: Captain-controlled themes, times, activities, intake fields, and Demo Day durations must be data-driven — weekly changes cannot require a deployment
- **Timing defaults**: New Demo Days start at 6 minutes presenting and 2 minutes questions, with explicit per-week captain overrides — defaults must not prevent formats such as 60 seconds plus 2 minutes
- **Compatibility**: Extend the existing static browser application and repository/transport boundaries unless a later phase explicitly justifies infrastructure changes
- **Security**: Dynamic participant and event data must continue to use the escaping helpers because the application renders with `innerHTML`

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use editable Tuesday-talk and Wednesday-workshop templates | Gives captains a strong starting structure without hard-coding each week's shape | — Pending |
| Collect proposals and availability before the captain schedules sessions | Matches the intended participant-first scheduling workflow | — Pending |
| Limit the first milestone to configuration, intake, scheduling, and publication | Delivers the core operational loop before adding live-event or follow-up tooling | — Pending |
| Start with standard intake fields that captains can add, remove, require, or rename | Provides flexibility without the complexity of a general-purpose form builder | — Pending |
| Archive weeks and allow cloning | Preserves history and makes recurring setup efficient | — Pending |
| Publish schedules publicly while keeping intake captain-only | Makes the event easy to discover without exposing participant details or availability | — Pending |
| Default Demo Day timing to 6 minutes presenting and 2 minutes questions, with captain overrides | Preserves the familiar format while allowing each captain to change the week without code edits | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-14 after initialization*
