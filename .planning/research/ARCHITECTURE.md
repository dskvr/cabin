# Architecture Research

**Domain:** Nostr-native recurring event scheduling and private participant intake
**Researched:** 2026-08-14
**Confidence:** MEDIUM

## Standard Architecture

### System Overview

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Browser SPA: routes, week screens, escaped HTML, delegated event handlers │
├───────────────────────┬───────────────────────────┬──────────────────────┤
│ Captain workspace     │ Participant workspace     │ Public schedule view │
│ config / assemble     │ discover / propose        │ read-only            │
└──────────┬────────────┴────────────┬──────────────┴──────────┬───────────┘
           │ commands                │ commands                │ queries
           v                         v                         v
┌──────────────────────────────────────────────────────────────────────────┐
│ Application services                                                        │
│ WeekPolicy · WeekReducer · Template/Clone · IntakeSchema · SchedulePublish │
│ Authorization is evaluated here, never inferred from a visible control.    │
└──────────┬─────────────────────────────┬─────────────────────────────────┘
           │ public state                │ captain-only envelope/inbox
           v                             v
┌───────────────────────────────┐  ┌──────────────────────────────────────┐
│ PublicWeekRepository          │  │ PrivateInboxRepository               │
│ 30078 addressable aggregates  │  │ NIP-44 + NIP-59 unwrap/project/index │
│ public schedules and archives │  │ private intake and private drafts    │
└──────────┬────────────────────┘  └──────────────┬───────────────────────┘
           │ verified event + retry/publish       │ verified outer/inner event
           └───────────────────┬──────────────────┘
                               v
                    NostrRepository / RelayConnection
                   relay query, subscription, signature check,
                     event index, pending-publish persistence
```

Retain the browser-only TypeScript SPA and the existing `NostrRepository` / transport boundary. Do **not** turn `DemoDayApp` into the week data store: it is already a 2,079-line render/controller and should be reduced to route activation and calls to week-focused services. The current repository already verifies incoming signatures before indexing and knows how to resolve parameterized replaceable events; the new model should extend those seams rather than give UI components relay access.

### Component Responsibilities

| Component | Responsibility | Typical implementation |
|---|---|---|
| `app/week-routes.ts` and thin views | Parse `week`, `captain`, archive and public-schedule routes; render role-appropriate escaped forms | Hash routes plus pure HTML render functions; no crypto or relay calls |
| `domain/week.ts` | Canonical `WeekV1`, activities, templates, timer config, status transitions, clone and validation | Pure types, validators and reducers |
| `domain/intake.ts` | Field schema, required-field validation, proposal/availability payload and submission-window rules | Pure validation with limits and discriminated field types |
| `domain/authorization.ts` | Decide captain, whitelisted participant, editable/publishable/archivable state | Pure policy functions run by command handlers *and* repository projections |
| `domain/schedule.ts` | Place accepted proposals into activities and generate safe public schedule projection | Pure reducer; public projection must never copy intake answers |
| `nostr/week-events.ts` | Build/parse public `30078` week and schedule aggregates, tags, `d` identifiers and revision rules | Event builders/parsers alongside existing `event-builders.ts` |
| `nostr/private-inbox.ts` | Discover DM relays, seal/gift-wrap, subscribe by recipient, unwrap and validate private logical events | Separate repository/index; never add decrypted content to public `EventIndex` or logs |
| `nostr/repository.ts` | Shared verified transport, public indexing, pending retry and notifications | Extend with narrow public-week query/subscribe APIs only |

## Recommended Project Structure

```text
src/
├── app/
│   ├── App.ts                 # shell, route lifecycle, repository notifications
│   ├── router.ts              # add week and public-schedule route parsing
│   └── weeks/                 # rendered views and UI-event-to-command adapters
├── domain/
│   ├── week.ts                # WeekV1, activities, templates, timers, archive/clone
│   ├── intake.ts              # constrained form schemas and submission validation
│   ├── schedule.ts            # private assembly and public projection
│   └── authorization.ts       # author/allowlist/state policy
├── nostr/
│   ├── repository.ts          # verified public event ingestion/query/subscription
│   ├── week-events.ts         # public event codecs/builders
│   ├── private-inbox.ts       # NIP-44/59 recipient inbox and private projection
│   └── event-index.ts         # reusable public and logical-private coordinate indexes
└── ui/
    └── weeks.ts               # escaped week, field and schedule components
```

Keep domain validation free of Nostr types where possible. `week-events.ts` is the only layer that decides tags, event kinds and JSON encoding; `private-inbox.ts` owns the additional cryptographic protocol and keeps private values out of ordinary public queries, caches and notices.

## Nostr Event and State Model

### Public, captain-authored aggregates

Use the existing NIP-78 `kind:30078` (`APP_KIND`) with stable, namespaced `d` values. NIP-78 explicitly reserves it for custom application data; NIP-01 makes this kind range addressable by `(kind, pubkey, d)` and relays may discard older versions. This is a strong fit for mutable captain state, but not an audit log. [NIP-78](https://github.com/nostr-protocol/nips/blob/master/78.md) [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md)

| Logical record | Public outer event | Stable identity / indexed tags | Content and rules |
|---|---|---|---|
| Week configuration | `30078`, captain signed | `d=cabin-week:<uuid>`, `t=cabin-week`, `t=cabin-v1` | `WeekV1`: title/theme/timezone, activities, constrained intake schemas, allowlist reference or snapshot/version, intake window, status, timer config and `revision` |
| Published schedule | `30078`, captain signed | `d=cabin-schedule:<week-uuid>`, `t=cabin-schedule`, `a=<week address>` | Only public activity times, titles, accepted presenter display information and a `source_week_revision`; no availability, form answers or unselected proposals |
| Archived week | the same week aggregate, final state | Week `d` remains unchanged; `status=archived` | Full final configuration remains readable and cloneable. It is an archive snapshot, not a deletion. |
| Clone | a new week aggregate | new UUID and `d`; optional `e`/`a` source reference | Copy structure and timer defaults, reset lifecycle/status, schedule, participant assignments, intake submissions and deadline-specific state. |

`WeekV1.timer` must be public captain configuration in the week aggregate: `{ demo_duration_ms, questions_duration_ms }`, defaulting to `360000` and `120000`. Validate positive integer bounds and persist an explicit value even when it equals the default. The future/retained Demo Day runner reads the selected week's timer config instead of module constants; it must snapshot those values when a run starts so a subsequent captain edit cannot rewrite an active elapsed-time calculation. This is configuration, not a new moderation workflow.

Every state-changing builder increments `revision` and uses `nextCreatedAt(previous.created_at)`. The `revision` is a semantic optimistic-concurrency guard: before replacing, refresh the aggregate, compare the expected event ID/revision and reject or ask the captain to merge if it changed. The NIP-01 tie-break protects relay selection, not captain intent. On fetch, require the exact `d`, `t`, payload version, signer/author relationship, safe bounded JSON and transition validity before projection.

### Private records: encrypted inbox, not public replaceable events

Participant proposals, availability, personal details and the captain's unpublished assembly draft must never be published as a regular `30078` event or tagged with the week address: tag queries and relay storage make those discoverable. NIP-44 encryption alone also exposes sender, recipient and time metadata. [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md)

Instead, send a signed, application-defined intake rumor to the captain with NIP-59 seal and per-recipient gift wrap (the NIP-17 delivery shape). The outer `kind:1059` carries only the captain recipient `p` tag and encrypted payload; the inner signed `kind:13` seal authenticates the participant and contains an unsigned `cabin-intake-v1` rumor. NIP-59 permits any event kind as a rumor and describes the seal/gift-wrap separation; NIP-17 requires clients to verify that the seal author matches the rumor author. [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md) [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md)

The private logical payload should contain `v`, `type`, `week_address`, `week_revision_seen`, a stable `submission_id` (`<week-uuid>:<participant-app-pubkey>`), `revision`, proposal fields and availability. Do **not** put any of those values in outer tags. `PrivateInboxRepository` decrypts only messages for the selected local identity, verifies outer event and seal/rumor linkage, validates the payload, then chooses the newest valid payload for `(week_address, sender pubkey, submission_id)` in a *private* logical index. This gives replaceable-like updates after decryption without claiming that a gift wrap is a public parameterized replaceable event.

For v1, also persist the captain's unpublished schedule draft as a self-addressed NIP-59 message in the captain inbox, projected by its own logical coordinate. That makes the static application recoverable across browser sessions without exposing draft roster decisions. An implementation may use a local draft first, but it must never silently fall back to a public relay event.

NIP-17 says to publish recipient messages to the recipient's `kind:10050` DM relays and uses NIP-44 plus NIP-59. Add relay discovery and a capability/error path before promising private intake; the present static relay list and transport do not implement this inbox protocol or NIP-42 relay authentication. Private ciphertext is still retained by relays and key compromise has no forward secrecy; state that limitation in product UI. [NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md) [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md)

### Authorization and privacy enforcement

Nostr signatures prove who signed an event; they do not make a captain role or whitelist authoritative. Apply the same `AuthorizationPolicy` at all four decision points:

1. **Before publish:** only the captain identity may mutate/configure/archive/clone/publish the selected week; a participant must be in the week's resolved allowlist and inside the intake window before the client encrypts a submission.
2. **After public ingestion:** accept a week or schedule projection only when the event signer equals the week captain and the expected `d`/address validates. Do not render a forged schedule merely because it bears the right tags.
3. **After private decryption:** accept an intake only when the sealed sender is in the resolved whitelist, the week is open for intake, the inner author matches the seal signer, and the referenced week address/revision is valid. This protects the captain inbox from spam and stale/unauthorized submissions even when a malicious client bypasses UI checks.
4. **Before render/export:** captain views can receive private projections; public/participant views receive only `PublicScheduleV1`. Never pass a raw `IntakeSubmission` through a general view model.

The canonical whitelist source is a required design decision for the implementation phase: `PROJECT.md` calls it existing, but the inspected repository documents identity and captain checks rather than a concrete whitelist store. Define an immutable per-week `allowlist_snapshot` or a signed, versioned allowlist address before intake is implemented; do not rely on an ambient profile/follow list whose meaning can change mid-week. If privacy of membership matters, keep the member list out of public week content and resolve it from the captain-private policy record instead.

Deletion is not a confidentiality or archive mechanism. A NIP-09 deletion is only a request, relays and clients can retain data, and clients must validate authorship of referenced events. Offer withdrawal by publishing a later private submission revision; disclose that already delivered ciphertext cannot be reliably recalled. [NIP-09](https://github.com/nostr-protocol/nips/blob/master/09.md)

## Architectural Patterns

### Pattern 1: Public aggregate + private projection

**What:** Keep only independently safe, captain-authored configuration and final published schedule in the public addressable aggregate. Derive all captain-only state from decrypted inbox messages.

**When to use:** Every feature involving proposals, availability, contact details, draft assignment or any field configurable by a captain.

**Trade-offs:** Public read/discovery is simple and relay-indexable; private delivery is more complex, requires compatible inbox relays and cannot support public filtering by week.

```typescript
function publicScheduleFrom(draft: ScheduleDraft, week: WeekV1): PublicScheduleV1 {
  assertCanPublish(week, draft);
  return {
    v: 1,
    type: "public-schedule",
    week_address: week.address,
    source_week_revision: week.revision,
    activities: draft.activities.map(({ starts_at_ms, title, presenters }) => ({
      starts_at_ms, title,
      presenters: presenters.map(({ display_name, proposal_title }) => ({ display_name, proposal_title })),
    })),
  };
}
```

### Pattern 2: Command/reducer with expected revision

**What:** Views create typed commands; a service refreshes current state, authorizes it, reduces it and builds one replacement event.

**When to use:** Configuration edits, timer overrides, archive transitions, clone creation and schedule publication.

**Trade-offs:** More code than direct form mutation, but prevents stale-tab overwrites and centralizes domain tests.

```typescript
async function updateWeek(command: UpdateWeek, expected: Version): Promise<void> {
  const current = await weeks.refresh(command.weekAddress);
  assertCaptain(command.actor, current);
  assertSameVersion(expected, current);
  const next = reduceWeek(current, command); // validates timer and lifecycle transition
  await weeks.publish(buildWeekEvent(next, nextCreatedAt(current.event.created_at)));
}
```

### Pattern 3: Parse, verify, authorize, then project

**What:** Treat relay events and decrypted payloads as untrusted input. Signature validity is necessary but insufficient.

**When to use:** Every repository ingest, refresh and subscription callback.

**Trade-offs:** It duplicates some checks across builders and parsers intentionally; builders protect honest clients while parsers protect all clients.

```typescript
const intake = await privateInbox.unwrap(item, identity);
if (!intake || !verifySealAuthor(intake) || !isAllowed(intake.author, policy)) return;
if (!isIntakeOpen(week, now) || !isValidIntake(intake.payload, week.schema)) return;
privateIndex.ingest(intake);
```

## Data Flow

### Captain config and timer override

```text
Captain form → week command → refresh current 30078 aggregate
  → authorize captain + validate activities/fields/timer bounds + expected revision
  → reduce WeekV1 (revision + 1) → sign replacement → NostrRepository.publish
  → verified public index / subscription notification → rerender
```

### Private proposal and availability

```text
Participant opens public WeekV1 → resolve/validate allowlist and intake window
  → validate constrained form locally → signed intake rumor
  → NIP-44 encrypt → kind 13 seal → per-recipient kind 1059 gift wrap
  → recipient kind-10050 relays
  → captain inbox subscription by recipient p tag → unwrap/verify/authorize/project
  → captain-only assembly workspace
```

### Schedule publication, archive and clone

```text
Captain-private schedule draft + accepted private submissions
  → schedule reducer → explicit public projection → captain authorization
  → replaceable cabin-schedule:<week-id> event → public read-only schedule route

Archive: final WeekV1 status=archived → same stable d
Clone: source WeekV1 → reset lifecycle/private/public assignments → new UUID/d → new captain event
```

### State Management

Keep ephemeral form drafts, busy states and notices in the app controller. Hold verified public events in `NostrRepository`; hold only decrypted, bounded private projections in `PrivateInboxRepository` memory (with separately encrypted/self-addressed recovery messages). Both expose `onChange`; a route activation owns subscriptions and always unsubscribes on navigation. Do not add a global mutable week object shared by views.

## Dependency-Aware Build Order

1. **Week domain contract and public codecs.** Define `WeekV1`, `ActivityV1`, constrained `IntakeFieldV1`, `TimerConfigV1`, statuses, public schedule projection, parser/builder tests and `d` namespace. Add routes/read-only discovery only after parsing works.
2. **Public repository integration and captain configuration.** Add scoped query/subscribe APIs, captain command service, optimistic revisions, template editing, activity scheduling, intake-field editing and the 6m/2m default with per-week timer override. Connect the timer reader to the persisted config with a start-time snapshot.
3. **Authorization policy.** Implement a concrete signed/snapshotted whitelist source, centralize role/window/state checks, then test bypass attempts at command and projection boundaries. This precedes private intake because the captain must have an enforceable accept/reject policy.
4. **Private inbox vertical slice.** Add NIP-44/59 cryptography, `10050` relay discovery, recipient subscriptions, unwrap/verification, private logical indexing and privacy/error UX. Test with multi-client relay fixtures before any intake UI ships.
5. **Intake and private assembly.** Implement form rendering/validation, proposal amendments, captain review, self-addressed private draft persistence and schedule reducer. Keep private types out of public render models.
6. **Publication, archive and clone.** Publish only the derived public schedule, freeze/archive a final week aggregate, clone from structure-only data and add route/integration tests for no intake leakage.

This ordering puts stable schema/addressing and authorization beneath all user flows, isolates the highest-risk privacy protocol before it gets UI breadth, and makes publication a deliberate one-way projection instead of an accidental exposure of the captain workspace.

## Scaling Considerations

| Scale | Architecture adjustments |
|---|---|
| 0–1k users | Static SPA, default relays, scoped public subscriptions and a per-captain private inbox are sufficient; cap field count/text sizes and private inbox history. |
| 1k–100k users | Query exact `d`, `a`, `t` and recipient tags; paginate/archive lazily; make relay sets configurable and respect recipient DM relay preferences. Avoid globally subscribing to every week or gift wrap. |
| 100k+ users | Add a relay strategy/indexing service only after an explicit infrastructure decision; retain client-side signature, policy and decrypt validation because server indexing cannot be the trust authority. |

**First bottleneck:** global subscriptions (`start()` currently subscribes broadly to app kinds) and full re-rendering. Replace with route-scoped public-week subscriptions and one private inbox subscription only for the active captain identity.

**Second bottleneck:** encrypted inbox volume/spam. Bound decryption work, deduplicate outer IDs, reject malformed/unauthorized messages after cryptographic validation, and preserve only the newest logical submission plus a small audit window.

## Anti-Patterns

### Public intake with an `a` tag

**What people do:** Publish proposal/availability as a normal event linked to the public week, then hide it in the UI.

**Why it's wrong:** Relays, other clients and tag searches can read it; UI visibility is not confidentiality.

**Do this instead:** Send the complete intake only through the recipient-encrypted NIP-59 inbox and project it only after decryption.

### UI-only captain/whitelist checks

**What people do:** Disable controls for non-captains/non-members but accept every valid signed event in repository projections.

**Why it's wrong:** Any client can construct a signed event and publish directly to relays.

**Do this instead:** Centralize authorization in domain functions invoked before publishing and after event/decrypted-payload ingestion.

### Replacing a published schedule with the private draft object

**What people do:** Reuse a schedule draft DTO as the public event content.

**Why it's wrong:** A later field addition can disclose availability, internal comments or rejected participants.

**Do this instead:** Require a separate `publicScheduleFrom` projection and test it has no private keys/values.

### Treating replaceable state or deletion as history/privacy

**What people do:** Assume an older relay event disappears, or a delete request erases ciphertext everywhere.

**Why it's wrong:** Replacement/deletion retention differs by relay/client and deletions are requests.

**Do this instead:** Keep archived final state self-contained, use a new address for clones, and design withdrawal as a later private revision with an honest privacy notice.

## Integration Points

### External Services

| Service | Integration pattern | Notes |
|---|---|---|
| Public Nostr relays | Existing `RelayConnection` through `NostrRepository`; scoped `30078` filters by author, `d`, `t` and `a` | Validate signatures, content and captain authorization; acceptance by a relay is not product authorization. |
| Recipient DM relays | Read captain `kind:10050`; publish/subscribe NIP-59 gift wraps by recipient `p` tag | New capability. Handle no configured inbox relays and relay AUTH/privacy limitations explicitly. |
| Browser local storage | Existing identity/pending-publication storage plus small local UI drafts only | Do not store decrypted intake indefinitely or use local storage as the authoritative cross-device private inbox. |

### Internal Boundaries

| Boundary | Communication | Notes |
|---|---|---|
| views ↔ command services | Typed command + view model | No Nostr event construction in DOM handlers. |
| domain ↔ Nostr codecs | Typed aggregate/payload ↔ signed event | Codecs enforce tags/version/limits; domain has no WebSocket dependency. |
| public repository ↔ private inbox | Shared transport and identity only | Separate indexes, subscriptions, storage and log/redaction rules. |
| private assembly ↔ public schedule | One-way `PublicScheduleV1` projection | Compile-time separate types plus runtime leakage tests. |

## Sources

- [NIP-01: event signatures, indexed tags, replaceable and addressable kinds](https://github.com/nostr-protocol/nips/blob/master/01.md) — primary, MEDIUM confidence via verified research seam.
- [NIP-78: application-specific `kind:30078` data](https://github.com/nostr-protocol/nips/blob/master/78.md) — primary, MEDIUM confidence via verified research seam.
- [NIP-17: private direct-message delivery](https://github.com/nostr-protocol/nips/blob/master/17.md), [NIP-44: encrypted payload limitations](https://github.com/nostr-protocol/nips/blob/master/44.md), [NIP-59: gift-wrap layering](https://github.com/nostr-protocol/nips/blob/master/59.md) — primary, MEDIUM confidence via verified research seam.
- [NIP-09: deletion requests](https://github.com/nostr-protocol/nips/blob/master/09.md) — primary, MEDIUM confidence via verified research seam.

---
*Architecture research for: Captain's Cabin recurring-week operations*
*Researched: 2026-08-14*
