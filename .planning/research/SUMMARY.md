# Project Research Summary

**Project:** Captain's Cabin subsequent milestone
**Domain:** Nostr-native recurring community-week scheduling and private participant intake
**Researched:** 2026-08-14
**Confidence:** MEDIUM

## Executive Summary

Captain's Cabin should become a bounded, recurring event-operations workflow: a captain configures a Tuesday-talk/Wednesday-workshop week, accepts private submissions from whitelisted participants, assembles a draft schedule, and explicitly publishes a safe public schedule. Keep the browser-only TypeScript SPA and its existing Nostr repository boundary. Store captain-authored public week state in addressable NIP-78 `kind:30078` events, while keeping proposals, availability, and unpublished schedule decisions in a separate recipient-private inbox flow. This follows the established event lifecycle documented by [pretalx](https://docs.pretalx.org/developer/architecture/concepts/) without expanding into a general event-suite product.

The critical technical decision is a hard public/private split. Use `nostr-tools@2.24.1` for NIP-17/NIP-59/NIP-44 private delivery, resolve the captain's NIP-17 `kind:10050` inbox relays, and never send confidential intake through default public relay fan-out. Public week configuration and the final schedule remain captain-signed `30078` records; a separate explicit projection produces public schedule data. This is necessary because encrypted content alone does not make public tags or event metadata private ([NIP-17](https://github.com/nostr-protocol/nips/blob/master/17.md), [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md), [NIP-59](https://github.com/nostr-protocol/nips/blob/master/59.md)).

The principal risks are privacy leaks, UI-only authorization, stale replaceable-event writes, and mutable schemas misreading historical submissions. Mitigate them with authorization at command and ingestion boundaries, immutable field IDs and schema revisions, expected-revision conflict handling, bounded parsing, escaped rendering, and relay-event inspection tests. Treat Demo Day timing as data-driven configuration of the existing timer: materialize each week's defaults as 360,000 ms presenting plus 120,000 ms questions, allow overrides such as 60,000 ms plus 120,000 ms, and snapshot durations when a run starts.

## Key Findings

### Recommended Stack

Retain vanilla TypeScript 5.8.3 and static hosting; no backend, framework, database, or general build migration is justified for this milestone. Add a narrow cryptographic/private-inbox adapter behind the existing repository rather than extending handwritten crypto. Because browser module imports need bundling, add `esbuild@0.28.2` for `src/main.ts`; retain TypeScript type checking. Use `@js-temporal/polyfill@0.5.1` for captain editing in an IANA zone and persist instants plus the IANA zone—`Date` alone cannot safely construct arbitrary-zone instants across DST.

**Core technologies:**

- **NIP-78 `kind:30078`:** public week configuration, templates, activities, timer configuration, lifecycle, and final schedule coordinates — addressable latest-state semantics fit captain-owned mutable state ([NIP-78](https://github.com/nostr-protocol/nips/blob/master/78.md)).
- **`nostr-tools@2.24.1`:** NIP-17/NIP-44/NIP-59 encryption, wrapping, and unwrapping — avoid custom ECDH/HKDF/padding/wrapper implementations.
- **NIP-17 + NIP-59 + NIP-44 v2:** encrypted participant proposal/availability envelopes sent through captain-selected recipient inbox relays — prevents content and most metadata from becoming public relay data.
- **`@js-temporal/polyfill@0.5.1`:** timezone/DST-correct civil-time input and instant conversion — store IANA zone plus explicit activity instants.
- **`esbuild@0.28.2`:** browser bundle for bare npm imports — keeps the existing static SPA delivery model.

### Expected Features

The v1 workflow must be structured and editable, not an unrestricted event builder: seed Tuesday and Wednesday templates, then let captains manage activities, chronology, a limited standard intake schema, and Demo Day durations. Participants need captain-private, whitelist-gated proposal and availability updates; captains need private review, manual placement with warnings, a distinct draft schedule, explicit public publication, archive, and configuration-only clone. The 6-minute presentation / 2-minute questions default and per-week overrides are table stakes within activity configuration, not a new live moderation subsystem.

**Must have (table stakes):**

- Editable Tuesday-talk and Wednesday-workshop templates with captain-controlled activities, times, order, and locations/links.
- Standard configurable intake fields with add/remove/rename/required controls, immutable `field_id`s, and schema revisioning.
- Whitelist-gated, captain-private proposals and availability, including participant amendments.
- Captain manual schedule assembly from private submissions, with an explicit draft/public distinction.
- Public schedule publication containing only approved presenter/session data and safe activity metadata.
- Read-only archive plus configuration-only clone with fresh identifiers.
- Per-activity Demo Day presentation/questions durations, persisted in milliseconds with defaults of 360000/120000.

**Should have (after workflow validation):**

- Published schedule revision history and optional public change notes.
- Availability-conflict visualisation.
- Additional standard field types/rules and a NIP-52 calendar projection only if demonstrated interoperability demand exists.

**Defer (v2+):**

- Live timer controls, moderation, speaker operations, notifications, attendance, feedback, payments, ticketing, CRM, conditional form logic, auto-scheduling, and multi-role review.

### Architecture Approach

Use a public aggregate plus private projection architecture. Thin routes/views issue typed commands; pure domain services own week, intake, schedule, authorization, validation, revisions, clone, and public projection; Nostr codecs own wire format. `NostrRepository` stays responsible for verified public transport and indexing, while a new `PrivateInboxRepository` exclusively discovers inbox relays, unwraps/validates gift wraps, and maintains bounded decrypted private projections. Do not make the current monolithic app controller the week store or allow UI handlers to construct relay events.

**Major components:**

1. **`domain/week.ts` and public event codecs:** define `WeekV1`, activities, constrained schemas, lifecycle, clone rules, timer config, `d` namespaces, and bounded parsing.
2. **`domain/authorization.ts`:** apply captain, whitelist, window, and lifecycle policy before publish and after public/private ingest; signatures establish authorship, not product authority.
3. **`nostr/private-inbox.ts`:** use NIP-17 delivery shape—application rumor, NIP-59 seal, per-recipient `kind:1059` gift wrap—to the captain plus sender recovery copy; validate inner and seal author linkage.
4. **`domain/schedule.ts`:** retain captain-private assembly and create an allow-listed `PublicScheduleV1` projection; private intake types never cross into public rendering.
5. **Week routes/views:** escaped role-specific forms and read-only public schedule routes, subscribing only for the active route/identity.

### Critical Pitfalls

1. **Publishing “private” intake as regular events or visible tags** — only recipient-encrypted NIP-59 envelopes may contain proposal, availability, identity, field, and week-reference details. Inspect emitted relay events in tests; deletion cannot reliably revoke copied data ([NIP-09](https://github.com/nostr-protocol/nips/blob/master/09.md)).
2. **Authorizing only in the UI** — re-check captain/signer, whitelist, week state, referenced revision, and inner author at command, public-ingestion, private-decryption, and projection boundaries.
3. **Silent last-writer-wins configuration loss** — put expected base revision/event ID on captain mutations, refresh before publish, track per-relay ACK/outbox state, and expose reload/merge conflicts instead of silently overwriting.
4. **Schema drift or unsafe relay JSON** — version all payloads, use immutable `field_id` answer keys and per-submission schema snapshots, parse unknown data with size/count limits, and escape every dynamic value.
5. **Leaking operational data through publication or clone** — project a distinct allow-listed public schedule; clone only configuration into fresh week/activity/form IDs and never copy submissions, assignments, recipient envelopes, publication IDs, or lifecycle state.
6. **Timer unit/global-default regressions** — use unit-bearing `presentation_ms`/`questions_ms`, materialize defaults per new week, retain legacy fallback only for old records, freeze a run snapshot, and boundary-test 60-second overrides.

## Implications for Roadmap

Based on research, the recommended phase structure is deliberately dependency-first and privacy-first.

### Phase 1: Public/private data contract and authorization foundation

**Rationale:** All later flows depend on a trusted week identity, event inventory, and enforceable policy. Private intake must not begin as a UI feature before its transport and acceptance rules are proven.

**Delivers:** `WeekV1`/public `30078` codec contract, stable namespaced `d` values, typed/limited parsers, canonical signed or snapshotted whitelist decision, shared authorization policy, expected-revision primitives, and relay/outbox state model.

**Addresses:** Captain-owned week configuration, Nostr-native identity, and the public/private product boundary.

**Avoids:** Relay-visible intake, UI-only captain/whitelist checks, malformed-event acceptance, and ambiguity over historical eligibility.

### Phase 2: Captain week configuration, templates, schema, and timer settings

**Rationale:** Activity timing, structured template/schema identities, and conflict-aware configuration must exist before a participant can safely submit or a captain can schedule.

**Delivers:** Editable Tuesday/Wednesday templates, activities with IANA zone/instants, constrained intake fields with `field_id` and revision snapshots, scoped public repository subscriptions, optimistic captain commands, and persisted per-week Demo Day timing defaults/overrides wired into the existing timer.

**Addresses:** Templates, captain activity management, configurable standard intake fields, and the locked 6m/2m default with overrides such as 60s/2m.

**Avoids:** Label/position-based schema corruption, stale-tab overwrite, DST errors, and seconds/milliseconds mistakes. Persist `demo_duration_ms=360000` and `questions_duration_ms=120000` explicitly; snapshot values at timer start.

### Phase 3: Private inbox and participant intake vertical slice

**Rationale:** After the week schema and policy are real, prove encrypted delivery end-to-end before adding broad captain-review UI.

**Delivers:** `nostr-tools`/esbuild integration, NIP-17 `kind:10050` relay discovery, recipient inbox publish/subscribe, NIP-59 gift-wrap/unwrap, private logical index, participant proposal/availability create/update form, sender recovery copy, and clear error/threat-model UX.

**Addresses:** Whitelist-gated captain-private submissions and participant-owned updates.

**Avoids:** Default-relay private fallback, cleartext relationship tags, missing inner-author checks, excess decrypt/re-render work, and claims that encryption protects compromised browsers.

### Phase 4: Private review, schedule assembly, and explicit public publication

**Rationale:** Manual captain placement can only follow validated private intake; publication must be a one-way projection from that workspace.

**Delivers:** Captain review, availability/conflict warnings, private schedule draft/recovery, manual activity placement, explicit publish action, captain-signed public schedule event, and public read-only route.

**Addresses:** Captain schedule assembly and public schedule publication.

**Avoids:** Serializing private proposal objects into public events, unauthorized schedule events, and accidental public identities. Require a fixture test proving sentinel private answers, availability, and rejected submissions never appear in emitted public event content or tags.

### Phase 5: Archive, immutable publication history, and configuration-only cloning

**Rationale:** Recurrence becomes trustworthy only after the core workflow is stable; archive/provenance needs clear immutable boundary semantics rather than a mutable flag.

**Delivers:** Final/archive snapshot semantics, public schedule revision/correction references, configuration-only clone transformation, fresh IDs/coordinates, source revision provenance, and source/clone isolation tests.

**Addresses:** Read-only historical weeks and practical reuse of recurring configurations.

**Avoids:** Treating replaceable state or NIP-09 deletion as an audit trail, identifier reuse, copied participant data, and cloned closed/private operational state.

### Phase 6: Hardening, migration, and operational regression coverage

**Rationale:** The cross-cutting risks—privacy, parsing, conflicts, and timers—need explicit verification beyond feature completion.

**Delivers:** Multi-client relay fixtures, unauthorized-event and privacy-inspection tests, old-payload migration fixtures, bounded query/decryption behavior, conflict/reconciliation UX, timer boundary/legacy tests, and per-relay publish status coverage.

**Addresses:** Reliable operation across stale relays/devices and the locked duration behavior for existing and future Demo Days.

**Avoids:** “Looks done” privacy/authorization failures, silent data loss, historical retiming, and performance collapse from global subscriptions.

### Phase Ordering Rationale

- Public data contract, authorization, and revisions precede configuration because every later event must be parsed and semantically accepted safely.
- Templates/schema/timing precede encrypted intake because submissions need immutable fields, a known week revision, a clear eligibility policy, and meaningful activity windows.
- The privacy protocol is isolated as a vertical slice before captain workflow breadth; no intake form ships until encrypted recipient-relay delivery is verified.
- Schedule publication is intentionally after private review and is a distinct DTO/projection, not a filtered private object.
- Archive/clone follows stable schema and publication semantics, then hardening validates every cross-boundary guarantee.

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 1:** resolve the canonical whitelist representation and historical eligibility policy; current project evidence lacks a concrete store.
- **Phase 3:** validate `nostr-tools@2.24.1` APIs, NIP-17/NIP-59 interoperability, `kind:10050` relay support, NIP-42 behavior, and multi-client relay fixtures; these NIPs are draft/optional.
- **Phase 4:** confirm public schedule snapshot/revision event inventory and exact disclosure/consent UX for presenter identity.
- **Phase 5:** specify immutable archive/publication provenance within the existing NIP-78 model; replaceable events alone are not durable history.

Phases with standard patterns (skip research-phase):

- **Phase 2:** typed domain reducer, versioned schemas, bounded validation, UI conversion of unit-labeled duration fields, and Temporal-based timezone handling are well-understood; focus planning on project integration.
- **Phase 6:** regression/migration fixtures, event-content privacy assertions, and route-scoped subscription bounds are standard verification work once contracts are set.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Official NIPs, maintained `nostr-tools` source/npm metadata, and MDN informed the recommendation; NIP-17/59/78 remain draft/optional and relay interoperability must be tested. |
| Features | MEDIUM | Official pretalx/Swoogo/Luma documentation establishes the workflow baseline; exact Captain's Cabin user demand needs validation after release. |
| Architecture | MEDIUM | Grounded in official NIP semantics and inspected existing repository/controller seams; private-draft recovery and archival event details need implementation-level decisions. |
| Pitfalls | MEDIUM | Protocol risks are official-source-backed and current-code timer evidence is high confidence; product mitigations are application-specific engineering judgments. |

**Overall confidence:** MEDIUM

### Gaps to Address

- **Canonical whitelist storage and revision policy:** decide whether eligibility is a public signed snapshot, private policy record, or another signed source; specify what happens when membership changes after a submission.
- **Inbox relay compatibility:** test captain-selected `kind:10050` relays, NIP-42 authentication, relay retention, and `nostr-tools` wrapping/unwrapping against real multi-client fixtures before promising private intake.
- **Archive/publication durability:** choose immutable snapshot/event references for final schedules, archive, and clone provenance; NIP-78 replacement alone cannot be an audit log.
- **Private draft recovery and local retention:** define encrypted self-addressed private drafts, cache limits, log redaction, and recovery behavior without making local storage authoritative.
- **Timer migration bounds:** set explicit permitted duration limits, legacy payload fallback, and the behavior when a captain changes configuration during an active Demo Day.

## Sources

### Primary (MEDIUM confidence due to optional/draft protocol status)

- [NIP-01: Basic protocol flow](https://github.com/nostr-protocol/nips/blob/master/01.md) — event signatures, addressable coordinates, relay semantics, and timestamp tie-breaking.
- [NIP-17: Private Direct Messages](https://github.com/nostr-protocol/nips/blob/master/17.md), [NIP-44: Encrypted Payloads](https://github.com/nostr-protocol/nips/blob/master/44.md), and [NIP-59: Gift Wrap](https://github.com/nostr-protocol/nips/blob/master/59.md) — recipient inbox routing, encrypted payload limitations, gift-wrap layering, and inner-author validation.
- [NIP-78: Arbitrary custom app data](https://github.com/nostr-protocol/nips/blob/master/78.md) — `kind:30078` application data.
- [NIP-09: Event Deletion Request](https://github.com/nostr-protocol/nips/blob/master/09.md) — deletion is a best-effort request, not privacy or history.
- [nostr-tools NIP-17 implementation](https://github.com/nbd-wtf/nostr-tools/blob/master/nip17.ts) and [NIP-59 implementation](https://github.com/nbd-wtf/nostr-tools/blob/master/nip59.ts) — supported wrapping API.

### Secondary (MEDIUM confidence)

- [pretalx concepts](https://docs.pretalx.org/developer/architecture/concepts/), [schedule workflow](https://docs.pretalx.org/user/schedule/), and [call for proposals](https://docs.pretalx.org/user/cfp/) — configurable submission, draft/release, availability, and public visibility workflow.
- [Swoogo clone-event API](https://swoogo.readme.io/reference/cloneevent) and [Luma registration questions](https://help.lu.ma/p/collect-registration-questions) — configuration-only cloning and standard required-field baseline.
- [MDN Temporal](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal) — native Temporal availability boundary.
- Project evidence inspected by researchers: public Nostr builders/repository/index/parsers, timer domain, relay configuration, and current app controller.

---
*Research completed: 2026-08-14*
*Ready for roadmap: yes*
