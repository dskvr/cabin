# Phase 1: Secure Week Configuration - Research

**Researched:** 2026-08-14  
**Domain:** Browser-only, captain-authorized Nostr week configuration  
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** A deployment-time cohort manifest defines the cohort beginning and end, captain `npub` assignments by week, the participant allowlist `npub`s, and a `starting_week` value that defaults to 1. The exact file/environment representation is not prescribed. — **Reversibility:** costly — changing the provisioning contract after launch would affect derived weeks and authorization inputs across later phases.
- **D-02:** The cohort start date anchors consecutive seven-day weeks in `Atlantic/Madeira`, regardless of weekday.
- **D-03:** `starting_week` skips earlier cohort slots while preserving cohort numbering. For example, `starting_week = 3` makes the third derived cohort week the first Cabin-enabled week and keeps its label as Week 3. — **Reversibility:** costly — published week coordinates and captain assignments may depend on this numbering.
- **D-04:** Weeks are pre-provisioned from the manifest rather than freely created. A captain can configure only the week assigned to their `npub`.
- **D-05:** A captain edits an assigned week locally. The first **Create week** action publishes one complete public configuration in a setup/intake-closed state; no partial shell is published while the form is incomplete.
- **D-06:** Later edits also remain local until the captain reviews them and explicitly selects **Publish changes**, producing one signed configuration revision rather than a relay event per keystroke.
- **D-07:** Published configuration can be edited again through a new local draft; publication is always an intentional captain action.
- **D-08:** Use one setup workspace with sections for week details, activities, proposal form, and Demo Day timing, followed by preview and publish controls.
- **D-09:** Activities appear as ordered, collapsible agenda cards grouped under Tuesday and Wednesday, with simple move and edit controls rather than a calendar grid or dense table.
- **D-10:** A Preview mode toggle replaces editing controls with the exact public-facing week view and provides a clear return-to-edit action.
- **D-11:** Show inline validation errors and a section-level readiness checklist. Publish remains disabled until every required configuration item is valid.
- **D-12:** Favor the smallest reliable end-to-end implementation. Phase 1 does not need exhaustive flexibility or polish, but its cohort derivation, captain authorization, draft/publish flow, and persisted configuration must work correctly.

### the agent's Discretion
- Choose `.env`, a generated TypeScript module, JSON, or another build-time representation for the cohort manifest, provided the required values are validated before use and no private keys are embedded.
- Choose the exact manifest schema, Nostr event kind/coordinate layout, serialization versioning, and code-module boundaries using the project research and existing repository conventions.
- Choose accessible controls for expanding, reordering, adding, and removing agenda cards while preserving the day-grouped card model.
- Choose exact field copy, visual styling, empty states, and responsive details using existing panel/form components and escaping helpers.
- Choose proposal-form schema locking rules and Demo Day duration bounds using the simplest safe behavior consistent with REQUIREMENTS.md; these areas were intentionally left to research and planning.

### Deferred Ideas (OUT OF SCOPE)
- Participant proposal submission, amendment, whitelist enforcement, and encrypted captain delivery — Phase 2.
- Private schedule assembly and explicit public schedule projection — Phase 3.
- Read-only archive and configuration-only cloning — Phase 4.
- Participant availability, publication history, advanced forms, and expanded event operations — v2+.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WEEK-01 | Captain can create a week from editable Tuesday-talk and Wednesday-workshop templates | Deterministic manifest-derived week slots and a complete local draft seeded from the two day groups. [VERIFIED: codebase graph] |
| WEEK-02 | Captain can add, remove, rename, and reorder activities | Versioned activity records use stable IDs and array order; cards supply explicit move controls. [VERIFIED: codebase graph] |
| WEEK-03 | Captain can set date, time, location, and link in Atlantic/Madeira | Civil-date and `HH:MM` validation is stored with the fixed IANA-zone marker; safe HTTP(S) URL normalization already exists. [VERIFIED: codebase graph] |
| WEEK-04 | Captain can set theme and public descriptive information | Required bounded theme and description live in the signed configuration payload. [VERIFIED: codebase graph] |
| TIME-01 | New Demo Day defaults to six presentation minutes plus two question minutes | Materialize `6` and `2` whole-minute values into each first configuration; do not continue relying on global timer constants. [VERIFIED: codebase graph] |
| TIME-02 | Captain can override per-week presentation and question durations | Validate each as an integer minute and pass persisted milliseconds into the existing pure timer in a follow-on wiring task. [VERIFIED: codebase graph] |
| FORM-01 | Captain can add, remove, and rename standard form fields | Form fields require a stable non-editable `id`, editable label, required flag, and order. [VERIFIED: codebase graph] |
| FORM-02 | Captain can mark fields required or optional | Persist `required`; Phase 2 consumes the same signed schema to validate submissions. [VERIFIED: codebase graph] |
| FORM-03 | Answers stay associated after rename or reorder | Future answers must be keyed by immutable field ID, never label or position. [CITED: .planning/research/SUMMARY.md] |
| ACES-02 | Only the designated captain can configure a week | Builder and parser must both compare the manifest-designated hex pubkey with the signed event author. [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md] |
| ACES-03 | Actions are accepted only when signed by the corresponding authorized identity | Repository verification proves a valid Nostr signer; semantic authorization adds the captain/week comparison before accepting a configuration. [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md] |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Never update documentation unless the user explicitly requests it.
- Default to code-only changes.
- Keep code clear and self-explanatory so documentation is not required to understand behavior.

## Summary

Build Phase 1 as a single public, captain-authored `kind:30078` configuration per derived week, identified by a deterministic `d` tag such as `captains-cabin:week:<cohort-id>:<week-number>`. NIP-78 explicitly permits `30078` app data with an app/context `d` tag, and NIP-01 gives `30000–39999` events latest-state semantics per kind, author, and `d` tag. [CITED: https://github.com/nostr-protocol/nips/blob/master/78.md] [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md]

The configuration is a fully validated local draft until the captain deliberately creates or publishes it. The parser—not the UI—must require the manifest's captain hex pubkey, the exact deterministic coordinate, correct version/type/tags, bounded payload, and a valid signature already verified by `NostrRepository`. The repository currently hashes and verifies every event before indexing, but its generic index does not establish product authorization. [VERIFIED: codebase graph] [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md]

Use date-only and wall-clock strings for this phase: the manifest derivation needs calendar days, and activity editing needs `YYYY-MM-DD`, `HH:MM`, and the fixed `Atlantic/Madeira` zone. Do not turn those local inputs into UTC instants in Phase 1; later schedule placement can introduce explicit instant conversion when it needs it. [ASSUMED]

**Primary recommendation:** Add a validated build-time TypeScript cohort manifest, a pure versioned `WeekConfigurationV1` domain model/validator, paired Nostr builder/parser/repository methods, and the approved one-column local-draft workspace—without installing packages. [VERIFIED: codebase graph]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Manifest validation and week-slot derivation | Browser / Client | — | Static hosting has no backend; the browser must deterministically derive only manifest-authorized slots. [VERIFIED: codebase graph] |
| Captain command authorization | API / Backend (domain boundary) | Browser / Client | In this static app, the equivalent enforcement point is the domain/parser boundary before publish and after relay ingestion, not visibility of a button. [VERIFIED: codebase graph] |
| Signed configuration persistence | CDN / Static | Nostr relay network | The SPA signs public state and `NostrRepository` publishes, retries, queries, and verifies it over relays. [VERIFIED: codebase graph] |
| Local draft, readiness, preview, and focus behavior | Browser / Client | — | `DemoDayApp` owns private mutable draft state and full-root escaped rendering. [VERIFIED: codebase graph] |
| Public configuration lookup | Nostr relay network | Browser / Client | The deterministic `(kind, captain pubkey, d)` coordinate identifies the latest addressable configuration returned from relays. [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md] |

## Standard Stack

### Core

| Library / Runtime | Version | Purpose | Why Standard |
|-------------------|---------|---------|--------------|
| Existing vanilla TypeScript SPA | TypeScript `5.8.3` pinned in project | Domain model, render/controller, and repository integration | The codebase already uses strict ES2022 TypeScript, named modules, and no application framework. [VERIFIED: codebase graph] |
| Existing handwritten Nostr protocol layer | repository source | Event signing, signature verification, relay transport, replaceable index | The repository already validates event shape/hash/Schnorr signature before indexing and retains failed publishes for retry. [VERIFIED: codebase graph] |
| Nostr NIP-01 + NIP-78 | current official specs | Addressable signed public configuration | `kind:30078` with `d` is the project’s existing app-data convention and its state fits one captain-owned mutable configuration. [CITED: https://github.com/nostr-protocol/nips/blob/master/78.md] [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md] |

### Supporting

| Library / Runtime | Version | Purpose | When to Use |
|-------------------|---------|---------|-------------|
| Browser `localStorage` via existing repository | browser API | Retain failed signed publication for retry | Reuse for the existing outbox only; a local editor draft remains non-authoritative and can be discarded. [VERIFIED: codebase graph] |
| Existing `escapeHtml`, `escapeAttr`, and URL validation helpers | repository source | Render untrusted dynamic strings and external links safely | Use on every theme, description, activity, location, link, form label, and error inserted into `innerHTML`. [VERIFIED: codebase graph] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing `30078` addressable configuration | A new app-specific regular event kind | Regular events require application-level latest-version selection and do not reuse the repository's addressable index convention. [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md] |
| Civil strings plus fixed zone | Temporal polyfill and stored instants | A polyfill is valuable once absolute schedule placement needs DST-aware conversion, but installing/bundling it exceeds the minimum Phase 1 need. [ASSUMED] |
| Existing protocol code | `nostr-tools` | Phase 1 has no new protocol feature beyond the project’s existing NIP-01/NIP-78 support; introducing a second signing stack would increase integration risk. [VERIFIED: codebase graph] |

**Installation:** No package installation is required for Phase 1. [VERIFIED: codebase graph]

**Version verification:** The installed/pinned project uses TypeScript `5.8.3`; the npm registry currently reports TypeScript `7.0.2`, but upgrading is unrelated to this phase and is not recommended in its plan. [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
Deployment-time cohort manifest (public npubs, dates, templates)
                         |
                         v
             validate + derive assigned week slot
                         |
          +--------------+---------------+
          |                              |
          v                              v
  identity is not assigned         local WeekConfigurationV1 draft
  -> read-only access panel                |
                                         validate/readiness
                                             |
                  +--------------------------+------------------------+
                  |                                                   |
                  v                                                   v
       preview exact public projection                      create / publish changes
                                                                  |
                                                         re-fetch latest coordinate
                                                                  |
                                                  build + sign one 30078 event
                                                                  |
                                             NostrRepository publish/retry/ingest
                                                                  |
                                      signature + shape + coordinate + captain parser checks
                                                                  |
                                                    latest public week configuration
```

This diagram follows the existing application/domain/Nostr/UI boundary, with relay calls confined to `NostrRepository`. [VERIFIED: codebase graph]

### Recommended Project Structure

```text
src/
├── config/
│   ├── cohort.ts            # deployment-time manifest, public data only
│   └── relays.ts            # existing event kind and relay constants
├── domain/
│   ├── cohort.ts            # parse manifest and derive pre-provisioned slots
│   ├── week.ts              # types, seed data, validation, readiness, preview projection
│   ├── authorization.ts     # captain/week authorization predicate
│   └── timer.ts             # accept persisted duration parameters without global-only defaults
├── nostr/
│   ├── event-builders.ts    # build signed configuration event
│   ├── event-parsers.ts     # strict configuration parse + semantic authorization
│   └── repository.ts        # discover, refresh, and publish configurations
└── app/
    ├── router.ts            # assigned-week hash route(s)
    └── App.ts               # local draft, approved setup workspace, notices/focus
```

The folder layout follows the project’s existing pure-domain, Nostr-codec/repository, and application-controller split. [VERIFIED: codebase graph]

### Pattern 1: Deterministic pre-provisioned coordinate

**What:** Decode every manifest `npub` to a validated lower-case 64-character hex key once, derive full seven-day calendar slots from the cohort start, apply `starting_week`, and resolve the active identity only against the matching assigned slot. NIP-19 treats `npub` as display/input encoding and specifies hex internally for NIP-01 events and filters. [CITED: https://github.com/nostr-protocol/nips/blob/master/19.md]

**When to use:** At startup, route resolution, public lookup, builder construction, and parser acceptance. [VERIFIED: codebase graph]

**Example:**

```typescript
// Source: synthesized from existing src/domain/utils.ts + NIP-01/NIP-19
const weekD = `captains-cabin:week:${cohort.id}:${slot.weekNumber}`;
const weekAddress = `${APP_KIND}:${slot.captainPubkey}:${weekD}`;

if (event.pubkey !== slot.captainPubkey || getTag(event, "d") !== weekD) {
  return null;
}
```

### Pattern 2: Complete immutable-on-publish payload, mutable local draft

**What:** Store a cloned local `WeekConfigurationV1` draft in `DemoDayApp`; validation returns structured section failures; only `Create week` or `Publish changes` signs a complete payload. The existing app uses private draft state and explicit repository publishing, while the UI contract requires no keystroke publication. [VERIFIED: codebase graph]

**When to use:** Every editor interaction, preview, readiness action, and retry after a relay/signing failure. [VERIFIED: codebase graph]

**Example:**

```typescript
// Source: synthesized from existing App.ts/repository publish pattern
const readiness = validateWeekConfiguration(draft, slot);
if (!readiness.ready) return focusFirstInvalid(readiness);

const latest = await repository.refreshWeek(slot);
if (latest?.event.id !== draft.baseEventId) throw new Error("Configuration changed elsewhere");

await repository.publish(await buildWeekConfigurationEvent({ draft, slot, identity }));
```

### Pattern 3: Stable form identity, presentation changes only

**What:** A form field is `{ id, label, required }`; reordering moves array elements and renaming edits only `label`. Phase 2 answers must use `field.id` as their key and carry the configuration/schema revision used at submission. [CITED: .planning/research/SUMMARY.md]

**When to use:** Seed, add, rename, reorder, remove, validate, serialize, and preview proposal form fields. [CITED: .planning/research/SUMMARY.md]

### Anti-Patterns to Avoid

- **UI-only captain check:** Hiding controls does not stop a forged or non-captain validly signed event from arriving through a relay; parser-level authorization is required. [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md]
- **Field label or array position as answer key:** A rename/reorder would orphan or misassociate future stored answers. [CITED: .planning/research/SUMMARY.md]
- **A relay event per input:** It violates the locked draft/publish flow and produces accidental partial public state. [VERIFIED: .planning/phases/01-secure-week-configuration/01-CONTEXT.md]
- **Trusting latest event semantics as authorization:** NIP-01 selects state by coordinate/timestamp but does not know the manifest’s designated captain. [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md]
- **Rendering arbitrary link/label markup:** The app replaces `innerHTML`; use escaped text/attributes and `normalizeOptionalUrl`. [VERIFIED: codebase graph]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Nostr event hashing and Schnorr verification | A second custom signing implementation | Existing `finalizeEvent` / `verifyEvent` and repository ingest | The current path checks canonical event hash and signature before indexing. [VERIFIED: codebase graph] |
| Addressable replacement ordering | Per-screen newest-event logic | Existing `EventIndex` plus deterministic coordinate | The index already chooses newer timestamps and lower IDs on a tie. [VERIFIED: codebase graph] |
| HTML escaping / attribute encoding | Template-string sanitizers | Existing `escapeHtml` / `escapeAttr` helpers | The current renderer is `innerHTML`-based and the helpers are its established safety boundary. [VERIFIED: codebase graph] |
| URL parsing | Regex URL acceptance | Existing `normalizeOptionalUrl` | It parses through `URL` and restricts allowed HTTP(S) schemes. [VERIFIED: codebase graph] |
| Relay retry/outbox | A week-specific queue | Existing `NostrRepository.publish` / pending retry | The repository already persists failed publishes and retries on startup/online. [VERIFIED: codebase graph] |

**Key insight:** Phase 1 needs new domain policy and codecs, not a new storage, crypto, relay, framework, or form library. [VERIFIED: codebase graph]

## Common Pitfalls

### Pitfall 1: Accepting any valid signer

**What goes wrong:** A correctly signed event from an unauthorized key becomes the visible configuration. [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md]

**Why it happens:** Signature verification proves authorship of an event but does not establish that its pubkey is the manifest-designated captain for that week. [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md]

**How to avoid:** Require `event.pubkey === slot.captainPubkey`, exact kind/type/`d`, and the manifest-derived week number in the strict parser; use the same predicate before signing. [VERIFIED: codebase graph]

**Warning signs:** Tests can inject a valid event signed by another key and it appears in the editor or public projection. [VERIFIED: codebase graph]

### Pitfall 2: Conflating draft and persisted state

**What goes wrong:** Incomplete or every-keystroke drafts leak into public relay state. [VERIFIED: .planning/phases/01-secure-week-configuration/01-CONTEXT.md]

**Why it happens:** The controller mutates the same object it later treats as published state. [ASSUMED]

**How to avoid:** Keep a cloned draft with a base event ID, validate the entire payload, and sign only on deliberate publication; retain the draft after a rejected relay publish. [VERIFIED: codebase graph]

**Warning signs:** A page reload observes partial configuration, or a relay failure deletes editor input. [ASSUMED]

### Pitfall 3: Stale concurrent revisions

**What goes wrong:** A second tab overwrites a captain’s latest configuration because addressable events use latest-state selection. [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md]

**Why it happens:** NIP-01’s replaceable model resolves a winning event; it is not a compare-and-swap transaction. [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md]

**How to avoid:** Record `base_event_id`, refresh the exact coordinate immediately before publish, block on a mismatch, and let the captain reload/reapply local changes. This is best-effort conflict detection; distributed relays cannot provide atomic CAS here. [ASSUMED]

**Warning signs:** A successful publish unexpectedly removes values edited in a different browser tab. [ASSUMED]

### Pitfall 4: Losing form-answer identity

**What goes wrong:** A renamed/reordered proposal field makes a later answer appear under the wrong question. [CITED: .planning/research/SUMMARY.md]

**Why it happens:** The schema uses labels or ordinal position as its identity. [CITED: .planning/research/SUMMARY.md]

**How to avoid:** Generate a field ID on add/seed, preserve it across label/order mutation, prohibit duplicate IDs, and require at least one valid field before publish. [CITED: .planning/research/SUMMARY.md]

**Warning signs:** Reordering changes serialized answer keys or a field rename creates a new ID. [ASSUMED]

### Pitfall 5: Date/time ambiguity and timer units

**What goes wrong:** A schedule appears in the wrong day/time or a one-minute override behaves as one millisecond/second. [CITED: .planning/research/SUMMARY.md]

**Why it happens:** Global timer constants are mixed with persisted values, or local wall time is converted without a declared zone. [VERIFIED: codebase graph]

**How to avoid:** Validate `YYYY-MM-DD` and `HH:MM`; persist an explicit `timezone: "Atlantic/Madeira"`; validate whole minutes then convert once to `presentation_ms` and `questions_ms` for timer use. [ASSUMED]

**Warning signs:** `1 + 2` renders other than `1:00 presentation + 2:00 questions`, or an activity displays a zone other than Madeira. [VERIFIED: .planning/phases/01-secure-week-configuration/01-UI-SPEC.md]

## Code Examples

Verified integration shapes from existing source and official Nostr specifications:

### Strict semantic parser after cryptographic verification

```typescript
// Source: existing repository ingest + NIP-01 event structure
export function parseWeekConfigurationEvent(
  event: NostrEvent,
  slot: ProvisionedWeek,
): ParsedWeekConfiguration | null {
  if (event.kind !== APP_KIND) return null;
  if (event.pubkey !== slot.captainPubkey) return null;
  if (getTag(event, "t") !== "captains-cabin-week") return null;
  if (getTag(event, "d") !== weekD(slot)) return null;
  const configuration = parseWeekConfigurationContent(event.content, slot);
  return configuration ? { event, configuration, address: weekAddress(slot) } : null;
}
```

`NostrRepository.ingest` must continue to call `verifyEvent` before this semantic parser is used. [VERIFIED: codebase graph]

### Field identity invariant

```typescript
// Source: synthesized Phase 1 domain invariant
type ProposalFieldV1 = {
  id: string;
  label: string;
  required: boolean;
};

function renameField(field: ProposalFieldV1, label: string): ProposalFieldV1 {
  return { ...field, label };
}
```

This shape intentionally makes a rename unable to change the answer key. [CITED: .planning/research/SUMMARY.md]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Ad hoc regular events plus client-side deduplication | Addressable `30000–39999` events with `d`-tag coordinates | Current NIP-01 | Relays can retain one latest state per coordinate, while the app still applies its own captain authorization. [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md] |
| Fixed module timer constants only | Persisted per-week unit-bearing duration values | This Phase | New weeks receive explicit defaults and later timer paths can consume configuration rather than global constants. [VERIFIED: codebase graph] |

**Deprecated/outdated:** Do not create new Phase 1 configuration as a free-form session using the existing random `sedd-session:*` coordinate; the new workflow requires a manifest-derived week number and assigned captain. [VERIFIED: codebase graph]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Date-only plus local `HH:MM` values are sufficient until actual schedule placement needs instants. | Summary | Later phases may require a Temporal/polyfill migration earlier than planned. |
| A2 | A 1–180 whole-minute timing range is a suitable bounded parser/UI policy. | Open Questions (RESOLVED) | A product need for longer sessions would require a config adjustment. |
| A3 | Re-fetch-and-compare `base_event_id` is enough MVP stale-draft protection despite no atomic relay CAS. | Common Pitfalls | Concurrent same-captain devices can still race after the check. |
| A4 | A final partial cohort period should be excluded; derive only full seven-day slots contained by the manifest end date. | Open Questions (RESOLVED) | A cohort operator may expect a truncated final week. |

## Open Questions (RESOLVED)

1. **Canonical manifest representation and commit policy**
   - What we know: It must be deployment-time validated public data and contain dates, captain assignments, participant allowlist, and `starting_week`. [VERIFIED: .planning/phases/01-secure-week-configuration/01-CONTEXT.md]
   - **RESOLVED:** Use `src/config/cohort.ts` as the deployment-visible TypeScript manifest module, validate its exported unknown data at the domain boundary, include no private key material, and keep test roster values in tests rather than treating them as production roster configuration. This is the representation selected by Plan 01. [PLANNED]

2. **Minimum proposal schema and timing ceiling**
   - What we know: The UI requires at least one valid field to publish and requires whole minutes of at least one. [VERIFIED: .planning/phases/01-secure-week-configuration/01-UI-SPEC.md]
   - **RESOLVED:** Seed required `Project title` and `Description` proposal fields with deterministic stable IDs, require at least one valid field before publication, and accept only whole-minute presentation/question durations from 1 through 180 inclusive. This is the schema and timing policy selected by Plan 02. [PLANNED]

3. **Cohort end-date behavior**
   - What we know: The start date anchors consecutive seven-day weeks and cohorts also provide an end date. [VERIFIED: .planning/phases/01-secure-week-configuration/01-CONTEXT.md]
   - **RESOLVED:** Derive only complete seven-day slots whose final date is on or before the manifest `end_date`; omit an incomplete terminal slot. This is the cohort boundary behavior selected by Plan 01. [PLANNED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Type check, build, and tests | ✓ | `v26.7.0` | — [VERIFIED: local environment] |
| npm | Existing build/test scripts | ✓ | `11.19.0` | — [VERIFIED: local environment] |
| Modern browser Web Crypto/WebSocket/localStorage | Signing, relays, outbox, UI | ✓ (project runtime requirement) | browser-provided | No Phase 1 fallback; this is the existing application platform. [VERIFIED: codebase graph] |
| Nostr relay connectivity | Public configuration publish/discovery | configured | default relay list in source | Repository retains failed publishes and retries. [VERIFIED: codebase graph] |

**Missing dependencies with no fallback:** None identified for the planned code/config-only implementation. [VERIFIED: local environment]

**Missing dependencies with fallback:** None. [VERIFIED: local environment]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Verify Nostr event shape, hash, and Schnorr signature before indexing. [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md] |
| V3 Session Management | no | This static Nostr app has local key identity rather than a server session. [VERIFIED: codebase graph] |
| V4 Access Control | yes | Compare signer and coordinate to the manifest-designated captain in builder/parser/repository queries. [VERIFIED: codebase graph] |
| V5 Input Validation | yes | Parse untrusted JSON through strict versioned/bounded domain validators; escape all rendered values and validate URLs. [VERIFIED: codebase graph] |
| V6 Cryptography | yes | Reuse current Nostr signing/verification; do not add bespoke crypto. [VERIFIED: codebase graph] |

### Known Threat Patterns for browser/Nostr configuration

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Valid signature by a non-captain | Elevation of privilege | Semantic parser requires manifest captain pubkey and exact week coordinate, after crypto verification. [VERIFIED: codebase graph] |
| Unsigned or tampered relay event | Tampering | Repository recomputes event ID and verifies Schnorr signature before indexing. [VERIFIED: codebase graph] |
| Malformed/oversized JSON payload | Denial of service | Set bounded string/count/array limits before accepting state; reject unknown shape/version. [ASSUMED] |
| Dynamic content rendered into `innerHTML` | Tampering | Escape text/attributes and allow only validated HTTP(S) links. [VERIFIED: codebase graph] |
| Stale captain draft | Tampering | Refresh coordinate and compare base event ID before deliberate publication; keep local draft on conflict/error. [ASSUMED] |

## Sources

### Primary (MEDIUM confidence)

- [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) — signed event structure, addressable kind range, latest-state tie behavior, relay filtering.
- [NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md) — `npub` is presentation/input encoding; NIP-01 uses hex keys.
- [NIP-78](https://github.com/nostr-protocol/nips/blob/master/78.md) — `kind:30078` custom app data and `d`-tag context.

### Secondary (MEDIUM confidence)

- Codebase knowledge graph and inspected symbols — `DemoDayApp` draft/publish flow, `NostrRepository`, crypto verification, replaceable index, escaping helpers, timer, and test harness.
- `.planning/research/SUMMARY.md` — stable form IDs, persisted timing units, parser bounds, revision/conflict guidance.

### Tertiary (LOW confidence)

- Assumptions A1–A4 — date/instant boundary, duration cap, best-effort stale protection, and full-week end-date policy.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — it reuses code already present and tested in this repository. [VERIFIED: codebase graph]
- Architecture: MEDIUM — the NIP coordinate and signing facts are official, while manifest/revision policy is application design. [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md]
- Pitfalls: MEDIUM — authorization and replacement mechanics are source-backed; user-facing conflict behavior is an explicit MVP policy. [CITED: https://github.com/nostr-protocol/nips/blob/master/01.md]

**Research date:** 2026-08-14  
**Valid until:** 2026-09-13
