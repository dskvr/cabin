<!-- refreshed: 2026-08-14 -->
# Architecture

**Analysis Date:** 2026-08-14

## System Overview

```text
Browser entry (`public/index.html`)
          |
          v
`src/main.ts` -> `src/app/App.ts` (DemoDayApp, routing/render/event orchestration)
          |                 |                 |
          v                 v                 v
  `src/domain/`       `src/nostr/`       `src/ui/`
  pure business       relay transport,  HTML escaping/components,
  rules/types         identity, events  motion
          |                 |
          +---------> `src/config/relays.ts`
                            |
                            v
                    Nostr relays over WebSocket
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Application shell | Owns browser event listeners, route activation, state, rendering, timers | `src/app/App.ts` |
| Router | Parses hash routes and builds navigation/session addresses | `src/app/router.ts` |
| Domain rules | Elo, timers, follows, exports, validation, and shared types | `src/domain/` |
| Nostr identity/events | Key handling, bech32, event construction/parsing, profiles and zaps | `src/nostr/` |
| Repository | Coordinates relay queries, validation, ingestion, pending persistence and subscribers | `src/nostr/repository.ts` |
| Relay transport | WebSocket connections, subscriptions, reconnects and publishes | `src/nostr/transport.ts` |
| UI helpers | Escaped HTML components and canvas motion effects | `src/ui/html.ts`, `src/ui/motion.ts` |

## Pattern Overview

**Overall:** Browser single-page application with a stateful application controller, functional domain modules, and an adapter-style Nostr repository/transport.

**Key Characteristics:**
- `DemoDayApp` performs explicit full rerenders into a root element and delegates event handling through root listeners (`src/app/App.ts:267`).
- Domain modules are mostly pure functions and interfaces, while Nostr concerns are isolated behind `NostrRepository` and `RelayConnection` (`src/domain/`, `src/nostr/repository.ts`, `src/nostr/transport.ts`).
- Hash routing drives page/session/display modes without a framework (`src/app/router.ts`).

## Layers

**Entry/application:**
- Purpose: Bootstrap the browser and coordinate UI state, routes, repository notifications, and user events.
- Location: `src/main.ts`, `src/app/`
- Depends on: domain, Nostr, UI, relay configuration.
- Used by: browser entrypoint `public/index.html`.

**Domain/core:**
- Purpose: Deterministic business calculations, serialization/export, validation, and types.
- Location: `src/domain/`
- Depends on: limited shared Nostr types/utilities where required.
- Used by: `src/app/App.ts` and Nostr modules.

**Nostr/infrastructure:**
- Purpose: Encode/sign/verify events, query and index relay data, manage identity and WebSocket lifecycle.
- Location: `src/nostr/`
- Depends on: domain types/utilities and browser WebSocket/storage APIs.
- Used by: `src/app/App.ts` and repository consumers.

**Presentation:**
- Purpose: Safe HTML generation and visual motion behavior.
- Location: `src/ui/`
- Depends on: browser DOM/canvas APIs.
- Used by: `src/app/App.ts`.

## Data Flow

### Primary Request Path

1. Browser loads `public/index.html`, which loads the bundled module from `src/main.ts`.
2. `src/main.ts` creates and starts `DemoDayApp` (`src/app/App.ts:267`), registering hash, form, click, input, drag/drop, and timer handlers.
3. `DemoDayApp.render()` resolves the route, reads identity/repository state, renders escaped HTML, restores focus, and activates motion (`src/app/App.ts:307`).
4. User actions call domain functions and repository methods; repository queries relay transport and verifies/ingests events (`src/nostr/repository.ts:126`).
5. Repository/transport change callbacks request another render; relay connections reconnect subscriptions after disconnect (`src/nostr/transport.ts:49`).

### Route Flow

1. `parseRoute` interprets `location.hash` in `src/app/router.ts`.
2. `navigate` updates the hash and `hashchange` invokes route activation.
3. `DemoDayApp` selects list/create/session/display/advanced rendering and ensures required route data.

**State Management:** Mutable UI state is private fields on `DemoDayApp`; relay/cache state is held by `NostrRepository`; identity is loaded through `src/nostr/identity.ts`; UI updates are event-driven and rerender-based.

## Key Abstractions

**DemoDayApp:** Application controller and renderer in `src/app/App.ts`.

**NostrRepository:** Validates relay results with `verifyEvent`, ingests accepted events, exposes queries and change notifications (`src/nostr/repository.ts`).

**RelayConnection:** Encapsulates one WebSocket relay, subscription/publish state, timeout and reconnect behavior (`src/nostr/transport.ts`).

**Domain types:** Shared session, event, profile, timer, and export contracts in `src/domain/types.ts`.

## Entry Points

**Browser bootstrap:**
- Location: `src/main.ts`
- Triggers: module script from `public/index.html`
- Responsibilities: construct the application and begin startup.

**Application startup:**
- Location: `src/app/App.ts` (`DemoDayApp.start`)
- Triggers: `src/main.ts`
- Responsibilities: start repository, subscribe to changes, install DOM listeners, activate route, start timer, render.

## Architectural Constraints

- **Threading:** Browser single-threaded event loop; asynchronous relay operations use promises/WebSocket callbacks.
- **Global state:** Browser globals (`location`, `globalThis` events, WebSocket, DOM) are accessed by `src/app/App.ts`, `src/app/router.ts`, and `src/nostr/transport.ts`.
- **Circular imports:** Not detected in the indexed import graph.
- **Rendering:** DOM is replaced through `root.innerHTML`; dynamic values must pass `escapeHtml`/`escapeAttr` from `src/ui/html.ts`.

## Anti-Patterns

### Direct relay access from UI

**What happens:** UI code bypasses `NostrRepository` and talks directly to WebSockets.
**Why it's wrong:** It duplicates verification, ingestion, retry, and connection lifecycle logic.
**Do this instead:** Add repository methods in `src/nostr/repository.ts` and consume them from `src/app/App.ts`.

### Unescaped dynamic markup

**What happens:** User/profile/event data is interpolated directly into templates.
**Why it's wrong:** The application renders via `innerHTML`, creating an injection risk.
**Do this instead:** Escape text and attributes with `src/ui/html.ts` helpers.

## Error Handling

**Strategy:** Async infrastructure rejects with descriptive errors; application catches operations and stores notices/busy state for the next render.

**Patterns:** Relay connection timeouts and close events reject pending operations (`src/nostr/transport.ts`); repository filters invalid events before ingestion (`src/nostr/repository.ts`); UI displays escaped error notices (`src/app/App.ts`).

## Cross-Cutting Concerns

**Logging:** Browser console calls are localized to infrastructure/debug paths.
**Validation:** Domain validators in `src/domain/utils.ts` and cryptographic event verification in `src/nostr/crypto.ts`.
**Authentication:** Local Nostr identity/key handling in `src/nostr/identity.ts`; no server session layer detected.

---

*Architecture analysis: 2026-08-14*
