# Coding Conventions

**Analysis Date:** 2026-08-14

## Naming Patterns

**Files:**
- Use lowercase kebab-free TypeScript filenames grouped by domain, such as `src/domain/event.ts` and `src/nostr/event-builders.ts`.

**Functions:**
- Use camelCase verbs for functions (`calculateElo`, `parseSessionEvent`, `buildExport`) and private class handlers use `#` names (`#notify`, `#handleOnline`) in `src/nostr/repository.ts`.

**Variables:**
- Use camelCase for local variables and parameters; use descriptive domain names (`presentationOrder`, `pairwiseVotes`, `sessionAddress`).
- Use SCREAMING_SNAKE_CASE for module constants such as `APP_KIND` and `DEFAULT_RELAYS` in `src/config/relays.ts`.

**Types:**
- Use PascalCase for interfaces, type aliases, and classes (`ParsedEntry`, `NostrTransport`, `NostrRepository`). Serialized wire fields intentionally use snake_case in `src/domain/types.ts`.

## Code Style

**Formatting:**
- TypeScript uses two-space indentation, semicolons, trailing commas, double-quoted strings, and multiline parameter/object formatting, as shown in `src/domain/elo.ts` and `src/nostr/repository.ts`.
- Prefer explicit return types on exported functions and public methods.

**Linting:**
- No ESLint or Prettier configuration is present. Type safety is enforced by strict options in `tsconfig.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and related checks).

## Import Organization

**Order:**
1. Node/built-in modules.
2. External packages.
3. Relative project modules.

**Path Aliases:**
- No path aliases detected; imports use relative paths, e.g. `../domain/timer.js` in `src/app/App.ts`.

## Error Handling

**Patterns:**
- Represent expected invalid input as `null`, `undefined`, or `false` after validation (`src/nostr/event-parsers.ts`, `src/nostr/repository.ts`).
- Async transport failures are rethrown after notifying listeners in `NostrRepository.publish`; retry paths deliberately retain pending work and swallow transient errors in `src/nostr/repository.ts`.
- Narrow unknown values with type guards such as `isRecord` in `src/domain/utils.ts`.

## Logging

**Framework:** console / browser diagnostics; no logging framework detected.

**Patterns:**
- Favor state/listener notification and return values over routine logging; user-visible failures are represented in application state in `src/app/App.ts`.

## Comments

**When to Comment:**
- Comment only non-obvious protocol or recovery behavior, such as retaining failed pending publications in `src/nostr/repository.ts`.

**JSDoc/TSDoc:**
- Not commonly used; exported APIs are made self-describing through names, interfaces, and return types.

## Function Design

**Size:** Keep pure domain functions focused (`src/domain/timer.ts`, `src/domain/elo.ts`); repository orchestration may be larger but should delegate parsing/indexing to dedicated modules.

**Parameters:** Prefer typed object parameters for operations with several related values (`buildEntryEvent` in `src/nostr/event-builders.ts`); use positional parameters for simple pure calculations.

**Return Values:** Return immutable-style derived values and typed records; use nullable results for parse/look-up misses and predicates for validation.

## Module Design

**Exports:** Use named exports throughout source modules; classes encapsulate mutable state with private fields (`src/nostr/repository.ts`).

**Barrel Files:** No barrel-index pattern detected. Import directly from the owning module.

---

*Convention analysis: 2026-08-14*
