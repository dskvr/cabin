# Sovereign Engineering Demo Day Tracker

A static, backend-free Nostr application for running Sovereign Engineering demo days. The browser discovers active sessions on eight fixed relays, creates and retains a local ephemeral identity, copies a participant's complete normal Nostr profile, publishes one participant entry per session, runs the captain-controlled timer, collects feedback and personal rankings, computes deterministic live Elo, supports presenter zaps, closes to an exact signed snapshot, exports AI-ready JSON, and derives real-account follow suggestions.

The authoritative product specification and the original implementation plan are included under [`docs/reference/`](docs/reference/).

## Run it

### Prerequisites

- Node.js 20.19 or newer.
- TypeScript 5.8.3. Running `npm install` installs the declared development dependency. The checked-in `dist/` directory can be served without installing build dependencies.
- A modern browser with WebSocket, Web Crypto, `localStorage`, and ES module support.

```bash
npm install
npm run verify
npm run dev
```

Then open `http://127.0.0.1:4173`.

Useful variants:

```bash
npm run dev -- --host 0.0.0.0 --port 8080
npm run build
npm run preview -- --port 4173
```

`npm run dev` performs a clean build and starts the static server. It does not run a hot-reload watcher. `npm run preview` serves the existing `dist/` directory and builds only when `dist/index.html` is missing.

## Commands

| Command | Purpose |
|---|---|
| `npm run check` | Strict TypeScript type-check without emitting files. |
| `npm test` | Clean build followed by all Node unit and integration tests. |
| `npm run verify` | Type-check plus the complete automated test suite. |
| `npm run build` | Produce the deployable static application in `dist/`. |
| `npm run dev` | Build and serve locally. |
| `npm run preview` | Serve an existing build. |

## Architecture

The application has no application server, database, authentication service, or relay configuration screen.

```text
Browser
├── DOM application and hash router
├── Pure domain logic
│   ├── timer
│   ├── Elo and pairwise results
│   ├── follow suggestions
│   └── normalized/raw JSON export
├── Nostr repository
│   ├── BIP-340 event signing and verification
│   ├── NIP-19 npub/nsec/naddr/LNURL encoding
│   ├── event schema validation
│   ├── replaceable-event resolution
│   ├── subscriptions and reconnects
│   └── optimistic publishing with a local retry queue
├── localStorage
│   ├── unencrypted ephemeral identity
│   ├── normal-account association
│   ├── account-specific lookup relays
│   └── pending signed publications
└── eight fixed Nostr relays
```

Protocol and domain code are kept out of the rendering layer. `NostrRepository` is the boundary between the application and either the real WebSocket transport or the in-memory test transport.

## Source layout

```text
src/
├── app/       routes, rendering, and user interactions
├── config/    protocol constants and fixed relay pool
├── domain/    types, timer, Elo, follows, and export
├── nostr/     crypto, NIP-19, events, identity, repository, transport, zaps
├── ui/        safe HTML helpers and generated identicons
└── main.ts    browser entry point

tests/
├── core.test.mjs
└── integration.test.mjs
```

## Test transport

The normal build uses `WebSocketNostrTransport`. Appending `?transport=memory` selects the in-memory transport for isolated browser work:

```text
http://127.0.0.1:4173/?transport=memory#/
```

This switch is deliberately explicit and is not persisted. It avoids public relays while exercising the same repository and rendering code.

## Security and privacy model

- The normal Nostr private key is never requested or used.
- The ephemeral `nsec` is stored unencrypted in `localStorage`, as required by the specification.
- The ephemeral secret is not placed in routes, protocol events, logs, or exports.
- Export generation recursively rejects known secret-key field names and any encoded `nsec` value while preserving unrelated custom profile fields.
- Every received event is shape-checked, hash-checked, and BIP-340 signature-checked before it can enter application state.
- A selected session route pins the captain's pubkey and `d` identifier; only that exact coordinate can update the selected session.
- A closed export is built only from the event IDs recorded in the final session replacement. Missing or invalid snapshot events disable export rather than silently substituting newer relay state.

## Deployment

Upload the contents of `dist/` to any static HTTPS host. The host must allow browser WebSocket connections to the fixed relay list and HTTPS requests to participants' LNURL endpoints. Hash routing means no server-side rewrite rules are required.

Before a real event, perform the operational checks in [`docs/TESTING.md`](docs/TESTING.md), especially relay write acceptance, profile visibility, LNURL CORS behavior, NIP-57 support, and front-display clock synchronization.

## Implementation notes

The supplied implementation plan recommended React and `@nostr/tools`. The build environment used for this delivery could not access a package registry, so the application uses dependency-free TypeScript and a small DOM renderer, with self-contained Nostr primitives. This preserves the specified static/no-backend architecture and makes the checked-in application runnable without runtime packages. The rationale and every other material decision are recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md). See also the [`acceptance-criteria map`](docs/ACCEPTANCE.md) and the [`delivery verification record`](docs/VERIFICATION.md).
