# Pitfalls Research

**Domain:** Nostr-native recurring event scheduling and participant intake
**Researched:** 2026-08-14
**Confidence:** MEDIUM — protocol claims are verified against the current official NIPs; the product-design mitigations are project-specific inferences.

## Critical Pitfalls

### Pitfall 1: Treating a hidden screen as private intake

**Confidence:** MEDIUM

**What goes wrong:** Proposal text, availability, names, or custom-answer values are published as ordinary events, plaintext content, or readable `p`/`a`/`d` tags, then merely omitted from the public UI. Any relay operator, relay client, indexer, or user who knows the filter can retrieve them. A deletion request later does not make this safe: it is only a request and cannot remove already replicated events and clients.

**Why it happens:** The existing application successfully verifies signed events, and it is tempting to equate a signature or whitelist with confidentiality. Nostr relays are distribution infrastructure, not an access-control database. NIP-44 encryption by itself also leaves event metadata such as `created_at` public; plaintext recipient or week tags reintroduce correlation.

**How to avoid:** Define two non-interchangeable event classes before building intake: (1) a public captain-signed week/schedule projection containing only intentionally public data, and (2) a private submission envelope encrypted to the captain. Use a NIP-17-style sealed and gift-wrapped envelope (NIP-44 + NIP-59) for each private proposal/availability, so the relay cannot read the application payload or associate the sender and recipient from public tags. On decrypt, validate the inner author's signature and enforce that it matches the claimed participant, then apply the whitelist. Put no names, availability, field labels, week title, or stable public schedule address in cleartext tags unless that disclosure is explicitly accepted. State the browser-key/XSS threat model plainly: encryption protects relay observers, not a compromised participant or captain browser.

**Warning signs:** A relay `REQ` can find submissions using an application tag; DevTools shows proposal JSON in an outgoing event; a private submission has a public `p` tag for the captain; the same public `d` tag appears on every proposal; or the design describes privacy only as “captain route” visibility.

**Phase to address:** **Phase 1 — private-data contract and Nostr transport foundation.** Make an end-to-end relay-observer test a release criterion before exposing an intake form.

---

### Pitfall 2: Enforcing captain and whitelist rules only in UI code

**Confidence:** MEDIUM

**What goes wrong:** A participant can publish a syntactically valid custom event directly to relays, or a stale/local client can accept an unauthorised update, because the application checks role only when rendering controls or handling a button click. A signature proves who authored an event; it does not prove that the author was the captain for this week or was whitelisted at the relevant revision.

**Why it happens:** The current mutation path correctly checks that the selected session event has the local identity's pubkey, but repository ingestion cryptographically verifies events before indexing them and has no general semantic authorization policy. Extending that pattern without a per-kind validator would make relay-originated events more trusted than they should be.

**How to avoid:** Establish one signed, captain-authored week-root record with a stable week identifier, captain pubkey, schema/config revision, lifecycle, and whitelist revision. Every parser/repository projection must validate cryptographic signature, event kind/tags, parent/week reference, author role, and lifecycle transition before accepting it. A captain-only configuration, schedule, archive, or clone event must be authored by the root captain key (or a separately verified delegation policy if that is deliberately introduced); a submission must be authored by its participant and be allowed by the authoritative whitelist policy. Resolve the whitelist policy explicitly: either evaluate against the current revision, or snapshot eligibility at submission time and keep that signed evidence. Do not use NIP-46 as authorization: it is a remote-signing transport, not a role model.

**Warning signs:** Authorization helpers live only in `App.ts`; `repository.ingest` accepts every signature-valid event of a new type; parsers do not receive an authorization context; a participant can craft a schedule event in a relay console; or removing a whitelist entry produces ambiguous historical submissions.

**Phase to address:** **Phase 1 — authorization policy and event validation**, then regression-test it again in **Phase 2 — captain templates/configuration** and **Phase 3 — participant intake**.

---

### Pitfall 3: Letting mutable addressable state substitute for an audit trail

**Confidence:** MEDIUM

**What goes wrong:** A week, template, or public schedule is one addressable event repeatedly overwritten. Older versions may be discarded by relays; an archive later cannot reproduce what was published; a clone has no reliable source snapshot; and a retracted public schedule remains discoverable on some relays. If the same `d` value is reused for different weeks, their histories collide.

**Why it happens:** NIP-01 addressable events are convenient because the coordinate is stable, and the current `APP_KIND` (30078) session builder already uses that model. But NIP-01 explicitly permits relays to retain only the newest event for a `(kind, pubkey, d)` coordinate. Replaceability is a current-state convenience, not durable version storage.

**How to avoid:** Separate current pointers from immutable records. Give every new week a fresh opaque `week_id`; never derive it only from a mutable title or date. Treat an editable captain configuration as a current addressable projection, but emit immutable, content-complete records for important boundaries: intake-schema publication, schedule publication, archive/finalisation, and clone source. Each immutable record carries `week_id`, schema/config revision, prior event id or content hash, and explicit provenance. The public schedule should be a sanitized snapshot, not a live view over private proposals. Show which published revision is current, but retain and reference earlier public revisions. NIP-09 can express a correction/deletion request for events the author owns; it cannot guarantee erasure and must never be the privacy or archive mechanism.

**Warning signs:** “Archive” means setting `archived: true` on the same addressable event; a clone references a live source coordinate but not a source event id; schedule changes overwrite the sole public record; `d` values are human labels; or old versions disappear after querying another relay.

**Phase to address:** **Phase 4 — schedule publication, archive, and clone provenance.** Define the event inventory and retention semantics before UI work.

---

### Pitfall 4: Accepting last-writer-wins as safe multi-device editing

**Confidence:** MEDIUM

**What goes wrong:** Two captain tabs/devices start from the same week state and publish conflicting template, schedule, or archive edits. NIP ordering chooses one newest event, silently losing the other edit. A local clock skew or same-second update produces a tie; the protocol's lexical event-id tie-breaker is deterministic but has no business meaning. Different relays can expose different current views during propagation or retention gaps.

**Why it happens:** The existing `nextCreatedAt` increments from the selected event and the index follows NIP-01 timestamp/id ordering. That handles sequential writes from one current view, not concurrent edits from stale views or multiple captain devices. Relay `OK` acceptance also only reports each relay's response, not global convergence.

**How to avoid:** Make every captain mutation carry the exact base revision/event id it edited. Before publish, refresh the authoritative week projection; after publish, reconcile the projection and surface a conflict if the base is no longer current. Initially support a single active captain editor and explicit reload/retry rather than silently merging full-object edits. Model participant submissions as independent participant-owned records, so one participant does not overwrite another; for a participant amendment, preserve a revision chain and select the latest valid one. Keep an outbox with event id, base revision, per-relay acknowledgement, retry status, and an “unconfirmed/pending” UI state. Bound, deduplicate, and paginate relay queries instead of trusting one EOSE/timeout snapshot as complete.

**Warning signs:** A full week JSON object is rewritten for every small change; no event contains `base_revision`/parent reference; publish success is shown after the first relay ACK; two browser tabs overwrite one another without a notice; or schedule order changes vanish after refresh.

**Phase to address:** **Phase 2 — captain templates/configuration and revision discipline**, with transport/outbox tests in **Phase 1** and schedule conflict tests in **Phase 4**.

---

### Pitfall 5: Evolving custom forms by labels, positions, or unsafe casts

**Confidence:** MEDIUM

**What goes wrong:** Renaming “Topic” to “Title,” reordering fields, or toggling required status changes the interpretation of stored answers. Old submissions fail parsing after a schema change, custom values are attached to the wrong label, and archived weeks cannot be rendered. A permissive `as` cast lets malformed relay JSON reach render or scheduling code.

**Why it happens:** The current parser intentionally recognizes only `v: 1` session content and validates a fixed shape. The milestone introduces captain-configurable fields, which is a schema product, not just variable labels. The existing direct JSON parsing/casting pattern will need a real migration boundary.

**How to avoid:** Version every application payload and maintain parser/migrator fixtures for every released version. Define fields with immutable `field_id`, explicit type, required flag, validation constraints, display order, and visibility; store answers keyed by `field_id`, never label or array index. Snapshot the form schema and schema revision in or alongside each private submission, so later template edits cannot reinterpret history. Validate decoded JSON as `unknown` at the repository boundary, apply size/count/length limits before rendering, preserve only supported fields, and migrate to an internal canonical model. Unknown future fields may be retained only when safe; unknown field types should be rejected or displayed as unsupported, not guessed. Escape all dynamic labels and answer values because the application renders via `innerHTML`.

**Warning signs:** Answers are an array aligned with current fields; field identity is `label.toLowerCase()`; a form edit changes old submission displays; version checks are removed to “make it work”; new fields are added to `v:1`; or tests include only the newest fixture.

**Phase to address:** **Phase 2 — template and schema contract**, before **Phase 3 — participant intake**. Migration and malicious-payload fixtures are mandatory acceptance tests.

---

### Pitfall 6: Cloning operational state instead of a clean configuration snapshot

**Confidence:** MEDIUM

**What goes wrong:** A clone inherits public schedule event ids, participant proposals, availability, archive/closed status, selection/order state, or template/field IDs. Editing the cloned week updates or reveals source-week data; the clone looks active but cannot accept submissions; or a participant's private data is accidentally republished in the new week.

**Why it happens:** The fastest implementation is a deep copy of the current serialized week object. But a recurring week has two classes of state: reusable configuration and one-week operational/history data. Replaceable Nostr coordinates make accidental identifier reuse especially damaging.

**How to avoid:** Define cloning as an explicit transformation with an allow-list: copy approved template defaults, activities, duration configuration, and field definitions; allocate a new `week_id`, new activity IDs, new form/schema revision, new addressable `d` values, draft lifecycle, and empty operational collections. Do not copy submissions, availability, public schedule publication ids, archive/closed flags, timers, or recipient/private envelopes. Store `cloned_from` as an immutable source event id plus source revision for provenance, without making it a public link to private source details. Present a review step before the first publish and test source/clone isolation both locally and through relay reload.

**Warning signs:** Clone is implemented by `JSON.parse(JSON.stringify(week))`; source and clone share a `d` tag or activity IDs; cloned week immediately shows old participants; clone can be found at the old naddr; or a closed week remains closed after cloning.

**Phase to address:** **Phase 4 — archive and clone.** Keep it after stable schema/config and before treating archives as a user-facing source of truth.

---

### Pitfall 7: Applying timer defaults globally or mixing seconds and milliseconds

**Confidence:** HIGH for current-code evidence; MEDIUM for migration guidance.

**What goes wrong:** A captain enters 60 seconds but the timer treats it as 60 milliseconds or 60 minutes; a new default silently retimes an existing Demo Day; question time is omitted; exported duration splits no longer match the timer; or a zero/negative/absurd duration breaks phase transitions. The current timer uses module-wide `PRESENTATION_MS` and `QUESTIONS_MS`, so a naive configuration change affects all sessions.

**Why it happens:** Nostr event timestamps are integer seconds, while the existing timer/domain fields and constants use milliseconds (`6 * 60 * 1000` and `2 * 60 * 1000`). UI copy often says “minutes” without making the stored unit explicit. Defaults are confused with a fallback evaluated during every render instead of values materialized when a week/session is created.

**How to avoid:** Make wire and domain names unit-bearing and unambiguous, e.g. `presentation_ms` and `questions_ms`; accept captain UI input in integer seconds/minutes only through a single converter. Persist both values on every newly created Demo Day/week configuration with defaults of 360000 ms (6 min) and 120000 ms (2 min); preserve a legacy fallback only for records created before the field existed. Permit 60000/120000 for the stated one-minute presentation example, validate safe integers, bounds, and non-negative policy, and reject implicit unit guesses. Parameterize `calculateTimer` and `splitPresentationTime` by the persisted per-session configuration, and freeze the duration snapshot when a live demo starts. Add boundary tests at 0, 1 ms, presentation end, questions end, overtime, old event fallback, and a changed default after an old week exists.

**Warning signs:** Constants are edited in `src/config/relays.ts` to “configure” one week; a config object uses `duration` without a suffix; UI says “6” but tests cannot tell the unit; only the visible countdown changes; or historical exports differ after deployment.

**Phase to address:** **Phase 5 — per-week Demo Day duration configuration and regression coverage.** It may be implemented alongside configuration UI, but it must not be released without legacy/read-only timing tests.

---

### Pitfall 8: Publishing a schedule by projecting private submissions wholesale

**Confidence:** MEDIUM

**What goes wrong:** The published schedule accidentally includes proposal notes, availability windows, contact values, custom answers, rejected submissions, or identities that were visible only for captain review. Future configuration changes then alter a page advertised as the finalized historical schedule.

**Why it happens:** The captain needs private records to assemble a schedule, and a direct serialization of the planning state appears convenient. Static clients also have no server-side projection layer by default, so it is easy to reuse the private view model for public rendering.

**How to avoid:** Make the public schedule a distinct captain-authored DTO/event built from an explicit allow-list (activity title, public start/end, approved presentation name only if approved, and public description). Require an affirmative public-identity choice when a proposal moves into the schedule; otherwise publish an anonymous slot. Never decrypt and republish private envelopes automatically. Validate this as a data-flow property: test a schedule event and all of its tags/content against fixtures containing sentinel private values and assert none reach a relay. Publish a final immutable snapshot plus a clearly labelled correction/revision record rather than modifying historical output in place.

**Warning signs:** The public route imports the private proposal type; schedule serialization contains arbitrary answer maps; a rejected proposal appears in relay data; public content is formed by spreading a private object; or the only review is visual browser inspection.

**Phase to address:** **Phase 4 — schedule assembly and publication.** Include a privacy regression test that inspects the exact events emitted.

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| One plaintext custom event kind for both public schedule and private intake | Few builders/parsers | Confidentiality breach and impossible safe migration | Never |
| One replaceable JSON document as current state and archive | Simple loading | Lost history, clone ambiguity, conflict loss | Only for a non-auditable draft pointer; never for published/archive snapshots |
| UI-only `isCaptain` / whitelist checks | Fast route implementation | Relay-crafted unauthorized state is accepted | Never |
| Field labels or array position as answer keys | Small form model | Renames/reorders corrupt interpretation | Never |
| Deep-copy a serialized week for clone | Fast first clone | Identifier reuse and private-data leakage | Never |
| Continue using global timer constants as defaults | Minimal change | Retimes historical weeks and exports | Only as read-only legacy fallback |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Nostr relays | Treat accepted publish/EOSE from one relay as globally durable/current | Track per-relay ACKs, retry, deduplicate by id, reconcile subscriptions, and show pending/conflict state |
| NIP-17/NIP-44 private transport | Encrypt only event content while exposing sensitive tags/metadata, or skip inner author validation | Use sealed/gift-wrapped recipient envelopes and validate the decrypted signed author plus application authorization |
| NIP-09 deletion | Promise that a private or mistaken event was erased | Use it only as a best-effort correction/disowning signal; assume copied relay/client data remains |
| NIP-46 remote signer | Treat a remote signature as delegated captain power | Keep captain role policy independent; remote signing only changes where the key signs |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Querying every configured relay for every private/public screen without limits | Slow load, duplicate records, high memory, stale view | Narrow kind/author/tag filters, result limits, id dedupe, incremental refresh | First large relay history or several active weeks |
| Re-decrypting and rerendering every private submission on any state change | Captain UI stutters and key use expands | Cache verified/decrypted projections in memory by event id; invalidate on new valid event | Dozens of submissions with full-root rerenders |
| Full week-object rewrites for field/schedule edits | Large events, conflict frequency, relay rejection | Use compact typed records and revision-aware operations/snapshots | A few editors or a growing form/schedule |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Private proposal values in plaintext events/tags | Public relay disclosure and irreversible replication | NIP-17-style encryption; public projection allow-list; event-inspection tests |
| Signature verification without semantic role checks | Participant or attacker injects configuration/schedule state | Per-kind authorization policy applied before indexing/rendering |
| Reusing captain's browser-stored signing key as if encryption makes the browser safe | XSS/extension/profile compromise can sign/decrypt as captain | Preserve escaping discipline, consider remote signing, warn users, and avoid putting excessive private data in the browser |
| Rendering captain-defined labels or participant answers with unescaped `innerHTML` | Stored DOM XSS via relay data | Validate limits and use the existing escaping helpers on every dynamic field |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Calling intake “private” without describing recipient and metadata scope | Participants disclose more than intended | Say “encrypted to this captain”; explain that relay/network metadata and compromised endpoints remain outside the promise |
| Silent replaceable-event conflict resolution | Captain believes a schedule change was saved when it was overwritten | Display base revision, pending publish state, and an explicit conflict/reload action |
| Applying template edits to an in-progress week without a revision boundary | Captains cannot explain which fields a participant answered | Freeze or version schema per submission and show the recorded revision |
| Ambiguous duration input | Demo Day runs at the wrong cadence | Label units, preview “1:00 presenting + 2:00 questions,” and persist unit-bearing values |

## "Looks Done But Isn't" Checklist

- [ ] **Private intake:** A relay-side event inspection proves proposal content and identifying tags are not readable without the captain's decryption key.
- [ ] **Captain actions:** Hand-crafted valid events from a non-captain are rejected from every derived view, not merely hidden in the UI.
- [ ] **Whitelist:** Tests cover submission before/after whitelist changes and define the historical eligibility outcome.
- [ ] **Schema changes:** A renamed/reordered field leaves old answers associated with their original immutable `field_id` and recorded schema revision.
- [ ] **Publication:** The emitted public schedule contains no sentinel values from proposal, availability, or rejected-submission fixtures.
- [ ] **Archive/clone:** A clone gets fresh week/activity/form identifiers and contains no private submissions or source lifecycle state.
- [ ] **Conflicts:** Two stale captain writes create a visible conflict/reconciliation result rather than silent loss.
- [ ] **Durations:** Existing Demo Days retain 6 min + 2 min after a later weekly override/default change; 60 sec + 2 min crosses timer phases correctly.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Plaintext private intake was published | HIGH | Stop publication, notify affected people, issue best-effort NIP-09 deletion requests, rotate/rework identifiers, and migrate to encrypted envelopes; do not claim deletion is complete |
| Unauthorized captain/schedule event accepted | MEDIUM | Correct with a captain-signed revision, blacklist invalid event ids in the derived projection, add semantic validation, and re-query relays |
| Schema migration broke historical weeks | MEDIUM | Restore versioned parser/migrator, retain source payloads, release fixtures for affected versions, and republish only a corrected projection if needed |
| Concurrent captain edit lost | MEDIUM | Retrieve both signed events, have the captain choose/merge explicitly, publish a new revision with both parents/provenance, and add stale-base detection |
| Clone leaked/copied source operational state | HIGH | Withdraw public clone where possible, create a clean fresh-id replacement, repair links, and audit emitted events for copied private data |
| Duration unit bug | MEDIUM | Freeze affected historical export interpretation, ship an explicit migration by version, correct new configuration, and regression-test phase boundaries |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Relay-visible “private” intake | Phase 1 — private-data transport | Capture actual emitted relay events; unauthorized reader cannot obtain content or sensitive tags |
| UI-only captain/whitelist authorization | Phase 1 — authorization policy | Inject signed non-captain/non-whitelisted events and assert they are excluded from projections |
| Schema drift and unsafe parsing | Phase 2 — templates and schemas | Version/migration and malicious JSON fixtures pass; historical answers retain field identity |
| Last-writer-wins conflicts and stale relay state | Phase 2 — revision discipline | Two stale tabs/devices produce pending/conflict UI and no silent overwrite |
| Public/private projection leak | Phase 4 — schedule publication | Public event fixture contains only approved allow-listed values |
| Non-durable archives and unsafe clones | Phase 4 — archive and clone | Source replacement/deletion cannot alter archive; clone has fresh identifiers and empty operational data |
| Global/mis-unit timer configuration | Phase 5 — per-week Demo Day durations | Legacy and overridden timing boundary/export tests pass |

## Sources

- [NIP-01: Basic protocol flow description](https://github.com/nostr-protocol/nips/blob/master/01.md) — official primary source; addressable/replaceable coordinates, timestamp tie-breaking, relay filtering, EOSE and per-relay acknowledgement semantics. Confidence: MEDIUM from the research confidence seam.
- [NIP-17: Private Direct Messages](https://github.com/nostr-protocol/nips/blob/master/17.md) — official primary source; NIP-44/NIP-59 sealed/gift-wrapped private transport and inner-author validation. Confidence: MEDIUM.
- [NIP-44: Encrypted Payloads (Versioned)](https://github.com/nostr-protocol/nips/blob/master/44.md) — official primary source; encrypted-payload limits and metadata/threat-model caveats. Confidence: MEDIUM.
- [NIP-09: Event Deletion Request](https://github.com/nostr-protocol/nips/blob/master/09.md) — official primary source; deletion requests do not guarantee removal from all relays/clients. Confidence: MEDIUM.
- [NIP-46: Nostr Remote Signing](https://github.com/nostr-protocol/nips/blob/master/46.md) — official primary source; remote signing is distinct from application authorization. Confidence: MEDIUM.
- Project evidence: `src/nostr/event-builders.ts`, `src/nostr/repository.ts`, `src/nostr/event-index.ts`, `src/domain/utils.ts`, `src/nostr/event-parsers.ts`, `src/domain/timer.ts`, and `src/config/relays.ts` inspected through the indexed code graph on 2026-08-14.

---
*Pitfalls research for: Nostr-native recurring event scheduling and participant intake*
*Researched: 2026-08-14*
