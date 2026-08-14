# Stack Research

**Domain:** Nostr-native recurring-week scheduling and private participant intake
**Researched:** 2026-08-14
**Confidence:** MEDIUM — primary Nostr specifications, maintained library source, and current npm metadata were checked. NIP-17, NIP-59, and NIP-78 remain optional/draft specifications, so relay interoperability must be proven against captain-selected relays.

## Recommendation

Keep the static browser-only TypeScript architecture. The existing captain-authored kind 30078 events already match NIP-78 arbitrary custom app data; retain that public state channel for the complete week document: templates, activities, intake schema, schedule, archive status, clone provenance, IANA zone, and captain-editable timer durations. Its addressable d tag gives each captain a stable week coordinate and latest-state semantics without adding a database.

Add a separate private-intake path: a proposal/availability is an app-defined structured rumor, NIP-59 gift-wrapped for exactly the captain and, recommended, the submitting participant's own key for recovery. Query kind 1059 only through the captain's NIP-17 inbox relays (kind 10050), then unwrap, validate, authorize against the public-week whitelist, and index locally. Never fall back to the existing public relay fan-out for confidential intake.

Use nostr-tools rather than extending the repository's hand-written cryptography with NIP-44, NIP-59, and NIP-17 code. Keep the current identity, event verification, repository, transport, and custom public-event model; add a narrow adapter behind the repository boundary.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Existing vanilla TypeScript + DOM | TypeScript 5.8.3 (existing) | Public week/template/schedule domain model and UI | Existing static SPA seams already suit this milestone; a framework migration does not improve Nostr privacy. |
| NIP-78 application data, kind 30078 | Existing standard | Public captain-authored week state | One parameterized replaceable event per captain/week with a versioned week payload and a unique d value such as secc-week:<128-bit-id>. |
| nostr-tools | 2.24.1 | Vetted NIP-17/NIP-44/NIP-59 encryption and wrapping | Exports nip17, nip44, and nip59; its NIP-59 helper creates/unwraps the rumor → seal → kind-1059 wrapper chain. |
| NIP-17 + NIP-59 + NIP-44 v2 | Current specifications | Confidential participant proposal and availability delivery | NIP-17 uses NIP-44 and NIP-59 to hide content and most event metadata; NIP-59 can wrap app-defined rumors. |
| @js-temporal/polyfill | 0.5.1 | Civil-time editing and DST-correct conversion | Persist an IANA zone plus instants. Browser Date cannot construct an instant in an arbitrary zone; native Temporal remains non-baseline. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| esbuild | 0.28.2 | Bundle browser modules | Required for bare npm imports: the current tsc-only build cannot ship nostr-tools/polyfill imports to a browser. Bundle src/main.ts to dist/assets/main.js while retaining static hosting. |
| Browser Intl.DateTimeFormat | Native | Display instants in stored or viewer zone | Format only; do not use for zoned editing/conversion. |
| Browser IndexedDB | Native, optional | Local cache of verified public events and encrypted private envelopes | Add only if inbox volume/offline recovery outgrows the present localStorage queue. It is not authoritative. |
| Browser Web Crypto | Native, existing capability | Secure RNG/primitives used by dependencies | Serve over HTTPS. Do not construct NIP-44 from primitives directly. |

### Nostr Event/Storage Contract

| Data | Transport and form | Visibility | Notes |
|------|--------------------|------------|-------|
| Week configuration, templates, activities, final schedule, archive/clone data | Captain-signed kind 30078 with stable d tag | Public | Version JSON payload; explicit state: draft, published, archived; domain/repository rejects non-captain writes. |
| Captain-editable Demo Day durations | Public-week fields demo_duration_ms default 360000; questions_duration_ms default 120000 | Public | Validate positive safe integer milliseconds and pass to existing timer engine; configuration only, no new timer/moderation subsystem. |
| Proposal and availability | Cabin-specific rumor wrapped with NIP-59, kind 1059 sent to captain plus sender copy | Captain-only; sender can recover | Inner payload: v, type, week_address, participant pubkey, schema answers, availability, update marker. Validate unwrapped author and public-week whitelist before acceptance. |
| Private delivery routing | Recipient NIP-17 kind-10050 inbox relays; NIP-42 where required | Metadata-minimized, not anonymous | If captain has no valid inbox list, block private submit and request configuration. Never publish to DEFAULT_RELAYS. |
| Local cache/retries | Existing pending queue; optional IndexedDB later | Device-local | Persist only wrapped events/ciphertext; cache is disposable. |

## Installation

    npm install nostr-tools@2.24.1 @js-temporal/polyfill@0.5.1
    npm install -D esbuild@0.28.2

Replace only final browser-module emission in scripts/build.mjs with an esbuild bundle of src/main.ts. Keep tsc --noEmit for existing type checks. This requires no server, framework, ORM, or general build-system migration.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| NIP-59-wrapped app rumor | Plain public kind-30078/other event | Never for proposals, availability, or personal details; public relay events/tags are visible. |
| nostr-tools NIP-17/NIP-59 adapters | Extend src/nostr/crypto.ts | Only if an audited interoperable internal NIP-44/59 implementation exists. It does not; custom ECDH/HKDF/padding/ChaCha20/MAC/wrapper code is an unjustified risk. |
| NIP-17 kind-10050 recipient inbox relays | Existing DEFAULT_RELAYS | Only for public week events. The hard-coded set is not a private inbox contract. |
| @js-temporal/polyfill | Native Date alone | Only if editing is explicitly tied to the captain device zone and DST/local-zone ambiguity is accepted. |
| Static app plus narrow bundling | Full backend/database/auth stack | Only if later milestones need enforceable at-rest access, large queries, server notifications, or relay-independent delivery. |
| Versioned week JSON in existing NIP-78 event | NIP-52 calendar migration | Only when external calendar interoperability becomes validated scope; it does not model private configurable intake. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| NIP-04 | NIP-51 says it is superseded for encrypted lists and NIP-44 is not a drop-in protocol. | NIP-17 delivery built on NIP-59 and NIP-44 v2. |
| Plaintext content, p, a, or t tags for intake | Relays/observers can read and correlate public events/tags. | Keep fields/references inside wrapped rumor; only recipient p tag appears on wrapper. |
| Shared browser group key stored in public ciphertext | It becomes a custom group-key protocol with rotation/recovery/revocation problems. | Per-submission NIP-17/NIP-59 delivery to single captain. |
| localStorage as authority | Per-device, disposable, cannot deliver to captain. | Signed relay events; storage only pending/retry/cache. |
| Form, calendar, state, or UI framework | Small standard-field v1 and existing full-rerender app already owns UI/validation. | Typed schemas, pure domain validation, existing escape helpers. |
| Server database/admin sessions/cloud crypto | Conflicts with Nostr-native browser-only boundary and duplicates current identity model. | Existing Nostr infrastructure plus captain inbox relay configuration. |

## Stack Patterns by Variant

**If a captain's week is draft or published:**

- Upsert the captain-signed kind-30078 event at the same d coordinate.
- Parameterized replaceable events provide stable latest configuration; archived copies are non-authoritative history.

**If a participant submits or edits intake:**

- Create a versioned Cabin rumor and gift-wrap separately for captain and sender; use a stable inner submission identifier and choose latest valid update after unwrap.
- A kind-1059 wrapper cannot be queried by inner tags without decryption; public tags would leak the relationship. Repository validates version, author, week, schema, and whitelist.

**If offline or private inbox relay is unavailable:**

- Retain only wrapped kind-1059 event in existing pending queue and retry configured recipient inbox relays.
- An unwrapped public fallback violates privacy.

**If captain edits Tuesday/Wednesday time or Demo Day duration:**

- Persist time_zone plus per-activity instant/start and duration. Persist timer defaults 360000 and 120000 milliseconds.
- Wall-clock time, time zone, and elapsed timer duration are different concepts; existing timer needs only configurable duration inputs.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| nostr-tools@2.24.1 | TypeScript >=5.0 | Existing TypeScript 5.8.3 satisfies peer range. Narrow imports from nostr-tools/nip17 and nostr-tools/nip59 for tree-shaking. |
| @js-temporal/polyfill@0.5.1 | Modern ES modules + esbuild | Explicitly polyfill: native Temporal is not cross-browser baseline. |
| esbuild@0.28.2 | Node >=20.19 | Production bundling only; retain Node test runner and static preview. |
| NIP-17 / NIP-59 | Captain-selected relays supporting inbox delivery and NIP-42 as applicable | Make relay support a preflight/config requirement, not an assumption about default relays. |

## Sources

- [NIP-78: Arbitrary custom app data](https://github.com/nostr-protocol/nips/blob/master/78.md) — kind 30078 addressable app data; **MEDIUM** (official, draft/optional).
- [NIP-17: Private Direct Messages](https://github.com/nostr-protocol/nips/blob/master/17.md) — NIP-44/59, kind 10050 recipient relay lists, one wrapper per recipient; **MEDIUM** (official, draft/optional).
- [NIP-59: Gift Wrap](https://github.com/nostr-protocol/nips/blob/master/59.md) — rumor/seal/gift-wrap and kind 1059; **MEDIUM** (official, optional).
- [NIP-44: Encrypted Payloads](https://github.com/nostr-protocol/nips/blob/master/44.md) — v2 and security limitations; **MEDIUM** (official, optional).
- [nostr-tools nip17](https://github.com/nbd-wtf/nostr-tools/blob/master/nip17.ts) and [nip59](https://github.com/nbd-wtf/nostr-tools/blob/master/nip59.ts) — wrapping API; **MEDIUM** (maintained primary source).
- [nostr-tools on npm](https://www.npmjs.com/package/nostr-tools) — verified current release 2.24.1; **MEDIUM**.
- [MDN: Temporal](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal) — native Temporal limited availability; **MEDIUM**.
- [MDN: Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) and [MDN: IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) — browser boundaries; **MEDIUM**.

---
*Stack research for: Nostr-native recurring-week scheduling and private participant intake*
*Researched: 2026-08-14*

