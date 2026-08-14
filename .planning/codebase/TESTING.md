# Testing Patterns

**Analysis Date:** 2026-08-14

## Test Framework

**Runner:**
- Node.js built-in `node:test`; tests are `tests/core.test.mjs`, `tests/integration.test.mjs`, and `tests/ui-theme.test.mjs`.
- `scripts/test.mjs` builds first, then runs `node --test tests/*.test.mjs`.

**Assertion Library:**
- Node built-in `node:assert/strict`.

**Run Commands:**
```bash
npm test                 # Build and run all tests
npm run check            # Strict TypeScript checking
npm run verify           # Typecheck, build, and tests
```

## Test File Organization

**Location:**
- Tests live in the top-level `tests/` directory, separate from implementation under `src/`.

**Naming:**
- Use `*.test.mjs`; group broad domain/repository coverage in `core.test.mjs`, cross-client behavior in `integration.test.mjs`, and source/static UI assertions in `ui-theme.test.mjs`.

**Structure:**
```text
tests/core.test.mjs
tests/integration.test.mjs
tests/ui-theme.test.mjs
```

## Test Structure

**Suite Organization:**
```javascript
import test from "node:test";
import assert from "node:assert/strict";

test("descriptive behavior statement", async () => {
  assert.equal(actual, expected);
});
```

**Patterns:**
- Use behavior-focused test names and one primary scenario per `test` block.
- Define small deterministic factories (`sessionState`, `entryState`, `makeState`, `makeEntry`) near the tests that use them in `tests/core.test.mjs` and `tests/integration.test.mjs`.
- Build artifacts are imported from `dist/assets`; `scripts/test.mjs` guarantees a fresh build before execution.

## Mocking

**Framework:** No mocking library detected.

**Patterns:**
```javascript
const transport = new InMemoryTestTransport();
const repository = new NostrRepository(transport);
```

**What to Mock:**
- Replace external relay behavior with `InMemoryTestTransport` from `src/nostr/transport.ts` for repository integration tests.
- Temporarily replace globals only when testing runtime fallbacks, as `tests/core.test.mjs` does for `globalThis.crypto`.

**What NOT to Mock:**
- Keep cryptography, parsers, event builders, and domain calculations real; tests validate signatures and independent secp256k1 derivation in `tests/core.test.mjs`.

## Fixtures and Factories

**Test Data:**
- Use deterministic hex keys, timestamps, event IDs, and object factories in test files; avoid randomness and live relay state.

**Location:**
- Fixtures are local helper functions in `tests/core.test.mjs` and `tests/integration.test.mjs`; no shared fixture directory detected.

## Coverage

**Requirements:** No numeric coverage threshold or coverage command is configured.

**View Coverage:** Not applicable.

## Test Types

**Unit Tests:**
- Pure crypto, encoding, parsing, indexing, domain calculations, export sanitization, and zap parsing are covered in `tests/core.test.mjs`.

**Integration Tests:**
- `tests/integration.test.mjs` simulates captain and observer repositories, publication, subscriptions, state replacement, ranking, closure, and export through the in-memory transport.

**E2E Tests:**
- No automated browser runner detected. `tests/ui-theme.test.mjs` performs static source/CSS/HTML assertions; browser runtime checks are documented in `docs/TESTING.md`.

## Common Patterns

**Async Testing:**
```javascript
async function waitFor(predicate, message, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}
```

**Error Testing:**
- Assert rejection/invalid outcomes directly with strict assertions; tampering tests verify `verifyEvent` returns `false` in `tests/core.test.mjs`, while integration polling fails with a descriptive `assert.fail` message.

---

*Testing analysis: 2026-08-14*
