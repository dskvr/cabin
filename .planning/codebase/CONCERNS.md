# Codebase Concerns

**Analysis Date:** 2026-08-14

## Tech Debt

**Hand-built browser application boundary:**
- Issue: `src/app/App.ts` owns routing, application state, data loading, event handling, and a large HTML render path. Rendering replaces `#root.innerHTML` on state changes and then has to restore focus and restart motion.
- Files: `src/app/App.ts`, `src/app/router.ts`, `src/ui/html.ts`
- Impact: Changes to one screen can affect unrelated interaction, focus restoration, subscriptions, or animation cleanup; regression surface is high.
- Fix approach: Extract route/state controllers and screen components with explicit render inputs; keep DOM ownership local to each screen and retain the existing escaping helpers.

**Custom protocol and cryptography implementation:**
- Issue: Nostr Bech32 and cryptographic primitives are implemented in-repository rather than using a maintained protocol library.
- Files: `src/nostr/bech32.ts`, `src/nostr/crypto.ts`, `src/nostr/event-builders.ts`
- Impact: Protocol edge cases and security fixes must be discovered and maintained locally; review and test burden is high.
- Fix approach: Add comprehensive RFC/NIP fixture coverage and assess a maintained upstream implementation, preserving the current public interfaces during migration.

## Known Bugs

**Verification command cannot run in a clean checkout:**
- Symptoms: `npm run verify` fails immediately with `sh: tsc: command not found` because dependencies are not installed in the current environment.
- Files: `package.json`, `package-lock.json`
- Trigger: Run `npm run verify` without first installing dependencies.
- Workaround: Run `npm ci` before verification; CI should explicitly perform this step and report dependency-install failures separately.

## Security Considerations

**Private key in browser localStorage:**
- Risk: `secret_key_hex` and its encoded `nsec` are persisted in cleartext localStorage. Any XSS, compromised browser extension, or shared browser profile can extract the signing key.
- Files: `src/nostr/identity.ts`, `src/config/relays.ts`
- Current mitigation: `validIdentity` validates shape and derives the public key from the stored secret; this does not protect confidentiality.
- Recommendations: Prefer non-extractable WebCrypto-backed storage where feasible, clearly warn users about the browser trust model, and provide explicit key export/removal controls.

**Dynamic HTML rendering requires continued escaping discipline:**
- Risk: `src/app/App.ts` builds large template strings with `innerHTML`; a missed escape on profile, relay, event, or route-derived data becomes DOM XSS.
- Files: `src/app/App.ts`, `src/ui/html.ts`, `src/domain/export.ts`
- Current mitigation: Shared `escapeHtml`/`escapeAttr` helpers are used in several paths.
- Recommendations: Centralize typed interpolation or use DOM APIs for untrusted values; add regression tests that assert escaping for every user/network-controlled field.

## Performance Bottlenecks

**ELO calculation repeatedly scans all entries:**
- Problem: Pairwise demo comparisons scan `entries` for every pair and call `ranking.indexOf` for each entry.
- Files: `src/domain/elo.ts`
- Cause: `calculateElo` has nested pair/entry loops plus linear searches (graph metrics report cognitive complexity 25, loop depth 3, and two scan-in-loop signals).
- Improvement path: Pre-index each entry's ranking positions once, then aggregate pairwise votes in a single pass; cap or paginate unusually large sessions.

**Full-root re-render on frequent state changes:**
- Problem: Every `render()` replaces the application DOM and reinitializes motion, timers, and focus recovery.
- Files: `src/app/App.ts`, `src/ui/motion.ts`
- Cause: Centralized state updates call `requestRender` for connection, profile, timer, and interaction changes.
- Improvement path: Split high-frequency timer/status updates from structural rendering and update only affected nodes.

## Fragile Areas

**Relay reconnect and subscription lifecycle:**
- Files: `src/nostr/transport.ts`, `src/nostr/repository.ts`
- Why fragile: A connection owns subscriptions, reconnect timers, pending publishes, and callbacks; close/error/reconnect paths mutate all of them asynchronously.
- Safe modification: Preserve idempotent cleanup, test first-connect, disconnect-before-ACK, reconnect, duplicate publish, and unsubscribe races with fake WebSockets.
- Test coverage: `tests/integration.test.mjs` exercises integration behavior, but no dedicated transport unit suite is detected.

**Identity migration and persistence:**
- Files: `src/nostr/identity.ts`, `src/domain/types.ts`
- Why fragile: A single serialized versioned object contains key material, imported-profile state, relay lists, and timestamps; malformed or partially migrated state silently returns `null` and can create a new identity.
- Safe modification: Add explicit migration/backup handling and tests for every persisted version and malformed-field combination before changing the schema.
- Test coverage: No focused identity persistence test file is detected.

## Scaling Limits

**Client-only relay aggregation:**
- Current capacity: Queries fan out to every configured relay and collect all events in memory until EOSE or a timeout.
- Limit: `query` has no result bound or deduplication before returning, so large relays/session histories can increase memory and render cost.
- Scaling path: Enforce filter/result limits, deduplicate by event id during collection, and introduce incremental/paginated loading.

## Dependencies at Risk

**Runtime dependencies without a lockfile integrity workflow:**
- Risk: The project depends on `gsap` and `qrcode-generator`, while the verification command assumes locally installed dev tooling; reproducibility depends on `npm ci` and lockfile consistency.
- Files: `package.json`, `package-lock.json`, `scripts/build.mjs`
- Impact: Fresh environments fail before tests and can drift if install steps are omitted.
- Migration plan: Pin and audit production dependencies, enforce `npm ci` in CI, and make build/test tooling availability part of the documented pipeline.

## Missing Critical Features

**Automated security and dependency checks:**
- Problem: No CI/security workflow or dependency audit configuration is detected in the repository listing.
- Blocks: Vulnerable transitive dependencies and protocol/security regressions can reach deployment without an automated gate.

## Test Coverage Gaps

**Transport, identity, and rendering security paths:**
- What's not tested: WebSocket lifecycle races, localStorage key handling, malformed persisted identities, and comprehensive HTML escaping.
- Files: `src/nostr/transport.ts`, `src/nostr/identity.ts`, `src/app/App.ts`, `src/ui/html.ts`
- Risk: Network failures, key-state corruption, or XSS regressions can go unnoticed.
- Priority: High

**Large-data domain behavior:**
- What's not tested: ELO performance/behavior with large entry sets and pathological rankings.
- Files: `src/domain/elo.ts`, `tests/core.test.mjs`
- Risk: Slow UI or incorrect rankings under realistic demo-day scale.
- Priority: Medium

---

*Concerns audit: 2026-08-14*
