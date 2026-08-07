# Implementation decisions

This log records choices made while turning the supplied specification and implementation plan into a working application.

## 1. The specification is authoritative

Where the implementation plan and the product specification differed, the specification won. The implementation therefore uses:

- application schema version `1` for both session and entry records;
- `current_demo_pubkey`, not `current_demo`;
- `snapshot_entry_ids`, `snapshot_profile_ids`, and `snapshot_zap_ids`;
- the `sedd.identity.v1` local identity shape;
- the exact ten-relay pool in the specification;
- one captain-owned kind-`30078` session and one participant-owned kind-`30078` entry per participant/session.

## 2. Static TypeScript with a small DOM renderer instead of React

The plan recommended React, Vite, and `@nostr/tools`. Package-registry access was unavailable in the implementation environment, so relying on those packages would have produced a project that could not be built or tested there.

The delivered application is still a static TypeScript browser application, but uses:

- native ES modules;
- a hash router;
- event-delegated DOM rendering;
- no runtime dependencies;
- one build-only TypeScript development dependency for normal external use.

The boundary proposed by the plan is retained: UI code does not construct Nostr filters, resolve replacement conflicts, or implement cryptography.

## 3. Self-contained Nostr primitives

To keep the application buildable without downloaded packages, the project includes focused implementations of:

- NIP-19 Bech32/TLV encoding and decoding for `npub`, `nsec`, `naddr`, and LNURL;
- secp256k1 arithmetic and BIP-340 Schnorr signing/verification;
- Nostr event serialization and hashing;
- a reconnecting multi-relay WebSocket transport.

These modules are isolated under `src/nostr/`, so replacing them with `@nostr/tools` later would not require rewriting the domain or rendering layers.

## 4. Exact closed snapshots are strict

The final session event is treated as a manifest. The closed summary requests the exact event IDs in all three snapshot arrays and validates them against the expected session and record types.

If any required ID is missing or invalid, the application:

- shows an incomplete-snapshot warning;
- disables JSON download;
- does not derive follow suggestions from substitute participant state.

This favors provenance and reproducibility over a more convenient but potentially inaccurate fallback to the latest relay values.

## 5. Optimistic rendering plus a persistent retry queue

Signed events are ingested locally before relay publication, so the browser immediately reflects a user's action. The same signed event is placed in `sedd.pending-publishes.v1` until one relay acknowledges it. Failed publications are retried on startup and when the browser returns online.

An operation is considered saved after the first positive relay acknowledgement while publication to the remaining relays continues best-effort.

## 6. Rapid replacements follow the specification's timestamp rule

A replacement uses:

```ts
Math.max(Math.floor(Date.now() / 1000), previousCreatedAt + 1)
```

This is the exact rule in the product specification. It guarantees an unambiguous winner for rapid changes to the same addressable coordinate. Writes are additionally debounced for drag-and-drop ranking edits.

## 7. The timer is entirely local

The captain publishes one `timer_started_at_ms` value. Every client derives presentation, questions, and overtime locally and updates the display every 250 milliseconds. No heartbeat, pause event, or timer-specific event exists.

## 8. Zap targeting uses two identities deliberately

A kind-`9734` request uses:

- `p`: the presenter's real pubkey, so payment goes to the normal account;
- `a`: the presenter's ephemeral kind-`30078` participant-entry address, so the payment is attributed to the demo;
- `k`: `30078`.

Receipt validation checks both signatures, the embedded target, the amount when parseable, duplicate IDs, and the LNURL service author when that service key is known. WebLN is attempted when available; otherwise the application shows a copyable invoice and a `lightning:` wallet link. A generated QR was not added because the specification describes that UX as optional and avoiding another large subsystem kept the dependency-free build small.

## 9. Lightning availability is determined conservatively in the UI

Blank or malformed copied `lud16`/`lud06` values do not produce an active zap button. Entry `zap` tags are omitted for blank fields. Actual NIP-57 support is confirmed only after loading LNURL-pay metadata.

## 10. Secret-export detection uses exact field names

The export guard rejects known secret/private-key field names and encoded `nsec` values. It intentionally does not reject broad substrings such as `private_notes` or `privacy`, because the profile-copy requirement says unknown custom profile fields must be preserved.

## 11. Test-only in-memory transport

`InMemoryTestTransport` implements the same query/subscribe/publish interface as the WebSocket transport. It is used for deterministic multi-client integration tests and can be selected in a browser only with the explicit `?transport=memory` query parameter.

## 12. No extra protocol records or configuration screens

The application intentionally does not add a roster, registration period, schedule, timer heartbeat, lifecycle log, co-presenter model, separate close event, or relay settings screen. Account-specific relays appear only in the profile/follow fallback flows and never join the shared demo-day relay pool.
