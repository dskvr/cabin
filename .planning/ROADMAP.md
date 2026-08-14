# Roadmap: Captain's Cabin

## Overview

Captain's Cabin will move from a focused Demo Day tool to a captain-operated recurring-week workflow: the captain securely configures an adaptable week, whitelisted participants submit captain-private proposals, the captain assembles and deliberately publishes a safe public schedule, and completed weeks become reusable history. The order protects the public/private boundary before any intake or publication workflow is introduced.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Secure Week Configuration** - Captains create, configure, and control signed weekly operations.
- [ ] **Phase 2: Private Participant Proposals** - Whitelisted participants safely deliver and amend encrypted proposals.
- [ ] **Phase 3: Schedule Assembly & Publication** - Captains turn private proposals into an intentionally public schedule.
- [ ] **Phase 4: Week Archive & Reuse** - Completed weeks remain read-only history and seed clean future weeks.

## Phase Details

### Phase 1: Secure Week Configuration

**Goal:** As a designated captain, I want to configure and publish my assigned week, so that I can tailor it without code changes.
**Mode:** mvp
**Depends on:** Nothing (first phase)
**Requirements:** WEEK-01, WEEK-02, WEEK-03, WEEK-04, TIME-01, TIME-02, FORM-01, FORM-02, FORM-03, ACES-02, ACES-03
**Success Criteria** (what must be TRUE):

  1. The designated captain can create a week seeded from editable Tuesday-talk and Wednesday-workshop templates, set its theme and public description, and change its activities without a deployment.
  2. The captain can add, remove, rename, reorder, and schedule activities with date, time, location, and link information interpreted in Atlantic/Madeira.
  3. The captain can configure the active proposal form by adding, removing, renaming, reordering, and marking standard fields required or optional, while saved answers remain attached to their original fields after label or order changes.
  4. A new Demo Day uses six-minute presentation and two-minute question durations, and the captain can set a different per-week combination such as one minute plus two minutes.
  5. Only a valid Nostr-signed command from the designated captain changes captain-controlled week or form configuration; unsigned, forged, or non-captain commands are rejected even outside the interface.

**Plans:** 4/4 plans executed
Plans:

- [x] 01-01-PLAN.md — Prove manifest assignment, deliberate signed publication, and verified repository read-back end to end
- [x] 01-02-PLAN.md — Complete the activity, timing, proposal-form, and readiness editor
- [x] 01-03-PLAN.md — Deliver the exact public preview and complete loading/error/responsive/accessibility UI states
- [x] 01-04-PLAN.md — Seal signed revision coordination and defense-in-depth Nostr authorization

**Execution order:** 01-01 → 01-02 → 01-03 → 01-04
**UI hint:** yes

### Phase 2: Private Participant Proposals

**Goal:** Whitelisted participants can submit and amend proposals that remain readable only to the designated captain.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** PROP-01, PROP-02, ACES-01, PRIV-01, PRIV-02
**Success Criteria** (what must be TRUE):

  1. A whitelisted participant can use the active proposal form to submit a proposal for the active week, and the designated captain can decrypt and read it.
  2. While intake is open, the proposal's original participant can amend it without being able to amend another participant's proposal.
  3. An identity absent from the participant whitelist cannot submit or amend a proposal, including by bypassing the interface.
  4. Relay-visible proposal events and tags expose neither proposal answers nor non-public participant or week details, and only the designated captain can decrypt the delivery.

**Plans:** TBD
**UI hint:** yes

### Phase 3: Schedule Assembly & Publication

**Goal:** Captains can privately assemble a safe schedule from submissions and explicitly release its public projection.
**Mode:** mvp
**Depends on:** Phase 2
**Requirements:** SCHD-01, SCHD-02, SCHD-03, SCHD-04, PUBL-01, PUBL-02
**Success Criteria** (what must be TRUE):

  1. The captain can privately review decrypted proposals and mark each one accepted or rejected.
  2. The captain can manually place accepted proposals into activity time slots and receives clear warnings for overlapping sessions, duplicate placements, or times outside configured activity bounds.
  3. The working schedule stays private and is not publicly viewable until the captain expressly publishes it.
  4. The captain can explicitly publish a finalized schedule that anyone can view without whitelist access.
  5. The public schedule shows only captain-selected approved presenter, session, and activity information; private proposal data, rejected proposals, and other non-public details are absent.

**Plans:** TBD
**UI hint:** yes

### Phase 4: Week Archive & Reuse

**Goal:** Captains can preserve completed weeks as read-only history and efficiently begin a clean new week from a prior configuration.
**Mode:** mvp
**Depends on:** Phase 3
**Requirements:** LIFE-01, LIFE-02, LIFE-03
**Success Criteria** (what must be TRUE):

  1. A completed week is available as a read-only archive after its active operations end.
  2. The captain can clone the configuration of any previous week into a new week with fresh week, activity, and form identifiers.
  3. A cloned week contains no participant proposals, participant details, placement decisions, or publication state from its source week.

**Plans:** TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Secure Week Configuration | 4/4 | In Progress|  |
| 2. Private Participant Proposals | 0/TBD | Not started | - |
| 3. Schedule Assembly & Publication | 0/TBD | Not started | - |
| 4. Week Archive & Reuse | 0/TBD | Not started | - |
