# Phase 1: Secure Week Configuration - Pattern Map

**Mapped:** 2026-08-14  
**Files analyzed:** 14  
**Analogs found:** 14 / 14

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/config/cohort.ts` | config | transform | `src/config/relays.ts` | role-match |
| `src/domain/cohort.ts` | model | transform | `src/domain/utils.ts` | partial |
| `src/domain/week.ts` | model | transform | `src/domain/types.ts` + `src/domain/utils.ts` | role-match |
| `src/domain/authorization.ts` | utility | request-response | `src/domain/utils.ts` | partial |
| `src/domain/timer.ts` | utility | transform | `src/domain/timer.ts` | exact (modify) |
| `src/nostr/event-builders.ts` | service | request-response | `src/nostr/event-builders.ts` | exact (modify) |
| `src/nostr/event-parsers.ts` | service | transform | `src/nostr/event-parsers.ts` | exact (modify) |
| `src/nostr/repository.ts` | service | request-response | `src/nostr/repository.ts` | exact (modify) |
| `src/app/router.ts` | route | request-response | `src/app/router.ts` | exact (modify) |
| `src/app/App.ts` | controller | event-driven | `src/app/App.ts` | exact (modify) |
| `src/ui/html.ts` | component | transform | `src/ui/html.ts` | exact (modify) |
| `public/styles.css` | config | transform | existing `.panel`, `.field`, `.button-*` rules | exact (modify) |
| `tests/core.test.mjs` | test | transform | existing domain/parser assertions | role-match |
| `tests/integration.test.mjs` | test | request-response | existing repository publish/relay tests | role-match |

## Pattern Assignments

### `src/config/cohort.ts` (config, transform)

**Analog:** `src/config/relays.ts`

Keep deployment-visible values as named exported constants; freeze collection values and keep persistence constants in the same config boundary.

**Imports/constant pattern** ([`src/config/relays.ts:1`](/Users/sandwich/Develop/cabin/src/config/relays.ts:1)):

```ts
export const APP_KIND = 30078;
export const DEFAULT_RELAYS = Object.freeze([/* values */] as const);
```

Put raw manifest data here only; perform schema, date, and npub validation in `domain/cohort.ts`, rather than making config consumers trust unchecked values.

### `src/domain/cohort.ts` and `src/domain/authorization.ts` (model/utility, transform/request-response)

**Analog:** `src/domain/utils.ts`

Follow small named pure functions, `unknown` boundary guards, lowercase hex validation, and `null` for invalid optional input. Export deterministic coordinate helpers adjacent to derivation/authorization functions.

**Validation and coordinate pattern** ([`src/domain/utils.ts:3`](/Users/sandwich/Develop/cabin/src/domain/utils.ts:3), [`:35`](/Users/sandwich/Develop/cabin/src/domain/utils.ts:35), [`:87`](/Users/sandwich/Develop/cabin/src/domain/utils.ts:87)):

```ts
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nextCreatedAt(previousCreatedAt?: number): number {
  const now = Math.floor(Date.now() / 1000);
  return previousCreatedAt == null ? now : Math.max(now, previousCreatedAt + 1);
}

export function sessionAddress(captainPubkey: string, sessionD: string): string {
  return `30078:${captainPubkey}:${sessionD}`;
}
```

Use a phase-specific `weekD(slot)` and `weekAddress(slot)` rather than extending the legacy random-session helpers; preserve pure manifest-to-slot derivation and a separate `isAssignedCaptain(slot, pubkey)` predicate.

### `src/domain/week.ts` (model, transform)

**Analogs:** `src/domain/types.ts`, `src/domain/utils.ts`

Use explicit version/type discriminators and snake_case persisted names. Put validation in a pure parser/validator that returns a result/readiness structure, never in the renderer.

**Versioned wire-model pattern** ([`src/domain/types.ts:44`](/Users/sandwich/Develop/cabin/src/domain/types.ts:44)):

```ts
export interface DemoDaySessionV1 {
  v: 1;
  type: "session";
  created_at_ms: number;
  closed_at_ms: number | null;
}
```

**Bounded text and safe link pattern** ([`src/domain/utils.ts:40`](/Users/sandwich/Develop/cabin/src/domain/utils.ts:40)):

```ts
export function clampText(value: string, max: number): string {
  return value.trim().slice(0, max);
}

export function normalizeOptionalUrl(value: string): string | null {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.href;
}
```

Model activity and proposal-field IDs as immutable properties; validation must check date/time strings, day grouping/order, required theme/description, at least one valid proposal field, whole positive minutes, and the fixed `Atlantic/Madeira` zone.

### `src/domain/timer.ts` (utility, transform)

**Analog:** itself, [`src/domain/timer.ts:14`](/Users/sandwich/Develop/cabin/src/domain/timer.ts:14)

Parameterize the existing pure functions with validated persisted durations (or add a configuration-aware pure wrapper); do not add UI or repository dependencies.

```ts
export function calculateTimer(elapsedMs: number): TimerState {
  const safeElapsed = Math.max(0, elapsedMs);
  if (safeElapsed < PRESENTATION_MS) {
    return { phase: "presentation", remainingMs: PRESENTATION_MS - safeElapsed };
  }
  // questions then overtime
}
```

Keep the established return shapes and milliseconds internally; convert the persisted whole minutes once at the domain boundary.

### `src/nostr/event-builders.ts` (service, request-response)

**Analog:** `buildSessionEvent`, [`src/nostr/event-builders.ts:12`](/Users/sandwich/Develop/cabin/src/nostr/event-builders.ts:12)

Add a narrow `buildWeekConfigurationEvent` beside the existing builder. Require an already validated configuration/slot and captain identity before calling this codec.

```ts
return finalizeEvent(
  {
    kind: APP_KIND,
    created_at: createdAt,
    tags: [["d", sessionD], ["t", "sedd-session"]],
    content: JSON.stringify(state),
  },
  secretKeyHex,
);
```

Copy the `kind`, deterministic `d`, type tag, `JSON.stringify`, `finalizeEvent` sequence, replacing only the legacy tag/coordinate. Builder-level captain equality is required before signing.

### `src/nostr/event-parsers.ts` (service, transform)

**Analog:** `parseSessionContent` / `parseSessionEvent`, [`src/nostr/event-parsers.ts:27`](/Users/sandwich/Develop/cabin/src/nostr/event-parsers.ts:27), [`:56`](/Users/sandwich/Develop/cabin/src/nostr/event-parsers.ts:56)

Parse opaque JSON as `unknown`, reject each malformed condition, then construct a parsed envelope only after exact semantic tags and the manifest captain/coordinate match.

```ts
export function parseSessionEvent(event: NostrEvent): ParsedSession | null {
  if (event.kind !== APP_KIND || !hasTag(event, "t", "sedd-session")) return null;
  const d = getTag(event, "d");
  if (!d || !/^sedd-session:[0-9a-f]{32}$/.test(d)) return null;
  const state = parseSessionContent(event.content);
  if (!state) return null;
  return { event, state, d, address: sessionAddress(event.pubkey, d) };
}
```

Do not treat signature verification as authorization: the repository verifies cryptography; this parser must additionally require `event.pubkey === slot.captainPubkey`, exact app tag, and `weekD(slot)`.

### `src/nostr/repository.ts` (service, request-response)

**Analog:** `queryRaw`, `publish`, and `refreshSession` at [`src/nostr/repository.ts:126`](/Users/sandwich/Develop/cabin/src/nostr/repository.ts:126), [`:142`](/Users/sandwich/Develop/cabin/src/nostr/repository.ts:142), and [`:231`](/Users/sandwich/Develop/cabin/src/nostr/repository.ts:231)

Add week-specific lookup/refresh/subscription convenience methods over the existing verified transport/index boundary; no UI relay access.

```ts
const raw = await this.#transport.query(relays, filter, options);
for (const item of raw) {
  if (await verifyEvent(item.event)) {
    valid.push(item);
    await this.ingest(item);
  }
}

await this.ingest({ event, relay: "local" });
// retain pending event before transport publish; rethrow transport failure
```

Refresh using `kinds: [APP_KIND]`, `authors: [slot.captainPubkey]`, and `"#d": [weekD(slot)]`; parse returned/indexed events through the strict week parser before exposing them.

### `src/app/router.ts` (route, request-response)

**Analog:** `parseRoute`, [`src/app/router.ts:14`](/Users/sandwich/Develop/cabin/src/app/router.ts:14)

Extend the discriminated `AppRoute` union and simple hash parsing; retain `invalid` fallback rather than allowing arbitrary route state.

```ts
if (parts.length === 0) return { name: "home" };
if (parts[0] === "create") return { name: "create" };
// decode only recognized address-bearing routes
return { name: "invalid", message: "Unknown page" };
```

The setup route should resolve the active identity’s manifest assignment in the app/domain layer, not accept a captain key from user-controlled hash input.

### `src/app/App.ts` (controller, event-driven)

**Analogs:** `#renderCreate`, `#createSession`, `#withBusy`, `#onInput`, and `#onSubmit` at [`src/app/App.ts:442`](/Users/sandwich/Develop/cabin/src/app/App.ts:442), [`:1166`](/Users/sandwich/Develop/cabin/src/app/App.ts:1166), [`:1287`](/Users/sandwich/Develop/cabin/src/app/App.ts:1287), [`:1716`](/Users/sandwich/Develop/cabin/src/app/App.ts:1716), and [`:1766`](/Users/sandwich/Develop/cabin/src/app/App.ts:1766).

Keep the week draft in private app state, render the entire root from that state, dispatch via `data-action`/`data-form-action`, and publish only through a busy-wrapped deliberate action.

```ts
async #withBusy(label: string, operation: () => Promise<void>): Promise<void> {
  if (this.#busy) return;
  this.#busy = label;
  this.requestRender();
  try { await operation(); }
  catch (error) { this.#notice = { kind: "error", text: error instanceof Error ? error.message : String(error) }; }
  finally { this.#busy = null; this.requestRender(); }
}
```

```ts
this.#drafts.set(`${scope}:${target.name}`, target.value);
```

Adapt this draft approach to structured week data (activity/form-field add/remove/reorder and expansion state). Validate before **Create week**/**Publish changes**; preserve draft on publish failure and refresh the exact coordinate before signing to detect stale `base_event_id`.

### `src/ui/html.ts` and `public/styles.css` (component/config, transform)

**Analogs:** `button`, `field`, and `textarea` at [`src/ui/html.ts:76`](/Users/sandwich/Develop/cabin/src/ui/html.ts:76), [`:85`](/Users/sandwich/Develop/cabin/src/ui/html.ts:85), and [`:113`](/Users/sandwich/Develop/cabin/src/ui/html.ts:113).

```ts
return `<button type="${options.type ?? "button"}" class="${escapeAttr(options.className ?? "button")}" data-action="${escapeAttr(action)}" ${options.disabled ? "disabled" : ""} ${options.attrs ?? ""}>${label}</button>`;
```

Reuse `.panel`, `.field`, `.button-primary`, `.button-secondary`, `.button-quiet`, `.button-danger`, and notice classes. Every dynamic label, value, location, URL, and `data-*` attribute goes through `escapeHtml`/`escapeAttr`; only use normalized HTTP(S) URLs as href values. Keep native semantic controls and add `aria-expanded`, disabled boundary move controls, live notices, and clear inline error associations.

### `tests/core.test.mjs` and `tests/integration.test.mjs` (test, transform/request-response)

**Analogs:** existing domain/parser unit assertions and repository-backed relay publish tests.

Add core coverage for manifest validation/derivation (including `starting_week`), activity/form identity and readiness validation, timer duration overrides, exact builder tags, and parser rejection of wrong kind/tag/d/captain/malformed content. Add integration coverage proving a valid captain event is discovered/published while a validly signed non-captain event is rejected from week state; assert failed publish retains the retryable event/draft-facing failure path.

## Shared Patterns

### Authorization and semantic validation

**Sources:** [`src/nostr/repository.ts:111`](/Users/sandwich/Develop/cabin/src/nostr/repository.ts:111), [`src/nostr/event-parsers.ts:56`](/Users/sandwich/Develop/cabin/src/nostr/event-parsers.ts:56)

Repository ingestion verifies event signatures before indexing; parser acceptance adds product-specific checks. Apply both to all week reads and writes.

```ts
validity = verifyEvent(item.event);
if (!(await validity)) return false;
```

### Explicit signed publication and failure retention

**Sources:** [`src/app/App.ts:1166`](/Users/sandwich/Develop/cabin/src/app/App.ts:1166), [`src/nostr/repository.ts:142`](/Users/sandwich/Develop/cabin/src/nostr/repository.ts:142)

Use `#withBusy` for UI notices/disabled state; `repository.publish` ingests locally, persists a pending event, removes it only after transport success, and rethrows failures. Never publish from an input handler.

### Escaped UI and optional URLs

**Sources:** [`src/ui/html.ts:76`](/Users/sandwich/Develop/cabin/src/ui/html.ts:76), [`src/domain/utils.ts:44`](/Users/sandwich/Develop/cabin/src/domain/utils.ts:44)

All dynamically rendered values must be escaped; link values also require normalization to HTTP(S). Reuse helpers rather than interpolating raw draft/configuration fields.

### Monotonic replacement timestamps

**Source:** [`src/domain/utils.ts:35`](/Users/sandwich/Develop/cabin/src/domain/utils.ts:35)

Use `nextCreatedAt(previousCreatedAt)` for addressable revisions so a rapid publish cannot lose to an earlier second timestamp.

## No Analog Found

None. The codebase has direct structural analogs for every planned file; the new manifest-derived slot and semantic captain authorization are new policy applied within existing domain/codec/repository patterns.

## Metadata

**Analog search scope:** `src/config`, `src/domain`, `src/nostr`, `src/app`, `src/ui`, `public`, `tests`  
**Files scanned:** 14 source/test files plus phase inputs  
**Pattern extraction date:** 2026-08-14
