# Feature Research

**Domain:** Nostr-native recurring community-week operations
**Researched:** 2026-08-14
**Confidence:** MEDIUM

## Feature Landscape

The established event-operations pattern is a bounded workflow: configure the event and its intake, collect submissions, let an organiser review and place accepted work in a draft schedule, then make an explicit public release. pretalx exposes that full lifecycle, including availability-aware scheduling and separately controlled public visibility. General event platforms likewise make reusable configuration and custom questions routine. Captain's Cabin should adopt this workflow, but retain its distinct Nostr identity and strict private/public boundary.

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Week created from editable Tuesday-talk and Wednesday-workshop templates | Recurring organisers need a useful, consistent starting structure without recreating the week. | MEDIUM | Template must seed activities, theme, date/time, and default intake schema as data; captains may add, remove, rename, reorder, and reschedule activities. It is not an unrestricted event builder. |
| Captain-editable activity timing and agenda | Scheduling products let organisers assign the day, start, end, and location/link before publication. | MEDIUM | Store an IANA timezone plus explicit start/end instants for every activity; validate no impossible interval. Preserve chronology in an archive rather than treating times as UI-only. NIP-52 time-based events use this same timestamp/timezone shape. |
| Configurable standard intake fields | Organisers expect to ask the questions appropriate to a talk or workshop, with labels and required status set for each week. | MEDIUM | Offer only the standard structured fields needed for v1 (e.g. title, summary, format, prerequisite/materials, availability) with add/remove/rename/required controls. Stable field IDs must survive label changes, cloning, and saved answers. |
| Private proposal and availability submission by whitelisted participants | Proposal platforms collect fields and availability before programme construction; a community intake without this cannot support participant-first scheduling. | HIGH | Allow create and replace/update for the active week, show each participant only their own submission, and enforce whitelist plus captain authorisation in repository/domain checks. NIP-17-style encrypted delivery is an implementation risk, not a reason to expose the data. |
| Captain review and manual schedule assembly | Organisers must see proposals, availability, conflicts, and unscheduled items before choosing the programme. | HIGH | Start with captain-selected placement and conflict/warning indicators, not algorithmic optimisation. A schedule remains draft until explicitly published. |
| Explicit public schedule publication | Mature products separate a working schedule from a released public schedule so updates are intentional. | MEDIUM | Publish only activity metadata and approved presenter/session details; never publish proposals, availability, or personal intake answers. Public output should remain readable without Nostr sign-in. |
| Archive and configuration-only week cloning | Repetition is core to weekly operations; event platforms clone sessions/forms/settings but do not carry registrations. | MEDIUM | Archived weeks are read-only historical records. Clone template, activities, timer settings, and field definitions into a new draft; never clone proposals, availability, assignments, or participant details. |
| Captain-editable Demo Day timer defaults | The existing app has Demo Day timing but week captains must tailor a planned activity's duration. | MEDIUM | Persist per-activity presentation and questions durations, defaulting to 6 minutes and 2 minutes. Allow values such as 60 seconds and 2 minutes. This configures the existing timer; it does not add live control or moderation. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Nostr-native identity and signed interaction | Whitelisted members participate with the identity they already control instead of creating another account. | HIGH | Preserve existing signed-event verification, relay/repository boundaries, and independent captain checks. This is product-defining, not optional polish. |
| Privacy-by-publication boundary | A public schedule can promote the week while sensitive proposals and availability stay captain-only. | HIGH | Model public schedule and private intake as separate event/data classes. Do not rely on hiding fields in the UI; relay-visible public events are not private. |
| Structured templates with local captain autonomy | Captains gain enough freedom to adapt theme, activity names, times, questions, and Demo Day parameters without the cognitive cost of an enterprise form/event builder. | MEDIUM | Present default Tuesday and Wednesday flows, then allow controlled edits. This is more useful than a rigid recurring-event copy and safer than arbitrary schema construction. |
| Transparent schedule revisions | Published schedule snapshots let attendees see the current programme while captains keep drafting later changes. | MEDIUM | v1 needs at least an explicit published snapshot and the current-draft/public distinction. Changelogs, participant notifications, and multiple named releases can wait. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Fully arbitrary event/form builder | It appears maximally flexible. | It erases the useful Tuesday/Wednesday model and adds schema types, branching, migrations, rendering, and validation that v1 does not need. | Editable activity templates plus a small standard field set. |
| Public proposals, availability, or intake answers | People may want social discovery or voting. | It violates the locked privacy boundary and makes sensitive data permanent on relays. | Publish only captain-approved schedule data; defer opt-in public profiles to a later, separately designed feature. |
| General conditional/branching form logic | Enterprise products support it. | Branching creates field-versioning and answer-visibility complexity without proving a recurring-week need. | Required/optional standard fields; add a narrowly specified conditional use case only after evidence. |
| Automatic scheduling/optimisation | It promises faster programme assembly. | Availability, priority, room constraints, and captain judgement have ambiguous rules; an optimiser can hide bad choices. | Captain manual placement with visible conflicts and availability. |
| Live timer controls, moderation, and speaker-management tools | Existing Demo Day demonstrates related capabilities. | They broaden the milestone from scheduling into operating an event. | Persist editable timer parameters now; defer runtime controls until the scheduling/publication loop is validated. |
| Reminders, attendance, feedback, payments, ticketing, and CRM workflows | These are common event-suite features. | Each adds notification delivery, data retention, and operational workflows beyond the stated v1. | Keep a clean exported/public schedule boundary and defer follow-up operations. |
| Clone participant data | It seems convenient for a recurring community. | It copies stale/private availability and proposals into a different week, breaking trust and data minimisation. | Clone only configuration and invite participants to submit fresh availability. |

## Feature Dependencies

```text
Editable Tuesday/Wednesday templates
    └──requires──> Week/activity domain model
                           ├──requires──> Captain-authorised configuration events
                           └──requires──> Stable activity and field identifiers

Configurable intake fields ──requires──> Stable field identifiers
Private proposal/availability ──requires──> Whitelist + recipient-private event design
Captain schedule assembly ──requires──> Private submissions + activity timing
Public schedule publication ──requires──> Draft schedule + explicit public projection
Archive/clone ──requires──> Immutable week snapshot + configuration-only copy rules
Editable timer parameters ──requires──> Activity configuration + duration validation

Public schedule ──conflicts──> Publishing private intake data
```

### Dependency Notes

- **Templates require a week/activity model:** Captains cannot make recurring configuration changes safely while the product is shaped around a single hard-coded Demo Day session.
- **Custom intake requires stable IDs:** labels and required flags are editable; storing answers by label would corrupt historical and cloned submissions.
- **Private intake requires recipient-private transport and server-side-equivalent checks:** the UI must not be the authority. NIP-17 is a draft/optional encrypted DM convention and requires recipient-relay support, sender verification, and a tested update/recovery path.
- **Schedule assembly requires availability and timing first:** conflict checks and manual placement are meaningless until activities have actual start/end values and candidate submissions exist.
- **Publication requires a projection:** create a minimal public schedule record from the captain's selected schedule, rather than republishing the private record with selected fields hidden.
- **Editable timer parameters require activity configuration:** the existing timer currently splits elapsed time against fixed constants, so the week/activity settings must become an input to timer calculations and exports.

## MVP Definition

### Launch With (v1)

- [ ] Editable Tuesday-talk and Wednesday-workshop week templates — establishes useful recurring structure while allowing captain adaptation.
- [ ] Captain-controlled activities and timing — includes names, ordering, schedule times, and editable Demo Day defaults of 6-minute presentation / 2-minute questions.
- [ ] Standard configurable intake fields — supports add/remove/rename/required without a general form engine.
- [ ] Whitelist-gated, captain-private proposals and availability — validates the participant-first workflow without weakening Nostr identity or privacy.
- [ ] Captain draft schedule and explicit public publication — closes the core operational loop.
- [ ] Archived weeks and configuration-only clone — makes the workflow practical for the next recurring week.

### Add After Validation (v1.x)

- [ ] Published schedule revision history and optional public change note — add after captains regularly update a published week.
- [ ] More standard field types and narrowly scoped field rules — add only when a repeated captain need cannot fit the initial field set.
- [ ] NIP-52 calendar-event projection/export — add if interoperability with Nostr calendar clients is a demonstrated need; it does not solve private intake or recurrence.
- [ ] Availability conflict visualisation — add once real submissions show that manual review needs stronger decision support.

### Future Consideration (v2+)

- [ ] Live timer/moderation controls — defer until running events is again a priority.
- [ ] Notifications, attendance, feedback, and post-event automation — defer until the core weekly loop is proven.
- [ ] Conditional form builder, multi-role review, auto-scheduling, ticketing, and integrations — defer because they create a separate event-suite product surface.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Week/activity templates and captain configuration | HIGH | MEDIUM | P1 |
| Editable timer defaults per activity | HIGH | MEDIUM | P1 |
| Standard configurable intake schema | HIGH | MEDIUM | P1 |
| Private proposal and availability intake | HIGH | HIGH | P1 |
| Captain draft schedule and public projection | HIGH | HIGH | P1 |
| Archive and configuration-only cloning | HIGH | MEDIUM | P1 |
| Public schedule revision history | MEDIUM | MEDIUM | P2 |
| Availability conflict visualisation | MEDIUM | MEDIUM | P2 |
| NIP-52 export/projection | MEDIUM | MEDIUM | P2 |
| Conditional forms, auto-scheduling, live operations | LOW | HIGH | P3 |

**Priority key:**

- P1: Must have for launch
- P2: Should have, add when validated
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | pretalx | Swoogo | Captain's Cabin approach |
|---------|---------|--------|--------------------------|
| Custom intake | Built-in/custom proposal fields, scopes, required modes, and answer visibility controls. | Custom registration fields, conditional paths, and reports. | Small editable standard field set: add/remove/rename/required; no branching in v1. |
| Availability and scheduling | Collects availability, schedules accepted sessions, warns of conflicts, and maintains WIP/released schedules. | Provides broad session/agenda management. | Private participant availability, captain manual assembly, then explicit public schedule projection. |
| Publication/privacy | Only the current public schedule is exposed to unauthenticated users. | Registrant data is managed within the platform. | Public schedule is separate from captain-only proposal/availability records; Nostr identity remains participant-owned. |
| Recurrence and cloning | Event lifecycle is event-specific. | Clone copies settings/sessions/forms/site configuration but not registrations. | Archive historical weeks; clone configuration only, always collect fresh private submissions. |
| Duration configuration | Session timing is part of schedule data. | Session/agenda management supports scheduled sessions. | Captain changes per-activity Demo Day presentation/question durations; defaults are 6m/2m, without adding live operation tools. |

## Sources

- [pretalx concepts: configurable submissions, review lifecycle, and schedule versions](https://docs.pretalx.org/developer/architecture/concepts/) — official documentation, MEDIUM confidence.
- [pretalx schedule: availability, draft/release, and public visibility](https://docs.pretalx.org/user/schedule/) — official documentation, MEDIUM confidence.
- [pretalx call for proposals: custom fields and public-answer control](https://docs.pretalx.org/user/cfp/) — official documentation, MEDIUM confidence.
- [Swoogo clone-event API: copies configuration, never registrations](https://swoogo.readme.io/reference/cloneevent) — official documentation, MEDIUM confidence.
- [Luma registration questions: type and required-status baseline](https://help.lu.ma/p/collect-registration-questions) — official documentation, MEDIUM confidence.
- [NIP-17 private direct messages](https://github.com/nostr-protocol/nips/blob/master/17.md) — canonical specification, MEDIUM confidence; marked draft/optional by the specification.
- [NIP-52 calendar events](https://github.com/nostr-protocol/nips/blob/master/52.md) — canonical specification, MEDIUM confidence; intentionally leaves recurrence and authorisation to clients.

---
*Feature research for: Captain's Cabin recurring community-week operations*
*Researched: 2026-08-14*
