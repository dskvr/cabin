# External Integrations

**Analysis Date:** 2026-08-14

## APIs & External Services

**Nostr relays:**
- Nostr WebSocket relays - query, subscribe to, and publish signed demo-day, profile, follow, and zap events.
  - SDK/Client: native browser `WebSocket`, implemented by `WebSocketNostrTransport` in `src/nostr/transport.ts`
  - Auth: Nostr event signatures and locally generated keys; no service API key
  - Endpoints: default relays in `src/config/relays.ts`; profile search relays are also configured there

## Data Storage

**Databases:**
- None. Events are held in an in-memory `EventIndex` (`src/nostr/event-index.ts`).

**File Storage:**
- Local browser downloads only, via export helpers in `src/domain/export.ts`.

**Caching:**
- Browser `localStorage` stores identity, pending publishes, and selected session state through `src/nostr/identity.ts` and `src/nostr/repository.ts`.

## Authentication & Identity

**Auth Provider:**
- Custom Nostr identity - keys are generated and validated locally in `src/nostr/identity.ts` and signed/verified by `src/nostr/crypto.ts`.
  - Secret material remains in browser storage; imported profiles and relay metadata are represented in the local identity record.

## Monitoring & Observability

**Error Tracking:**
- None detected.

**Logs:**
- Development/build status and server errors use `console` in `scripts/build.mjs` and `scripts/serve.mjs`; relay notices are surfaced through transport handlers in `src/nostr/transport.ts`.

## CI/CD & Deployment

**Hosting:**
- Static hosting is supported; `scripts/build.mjs` emits `dist/`.

**CI Pipeline:**
- None detected in the repository.

## Environment Configuration

**Required env vars:**
- None for the browser application.
- Optional local server variables: `PORT`, `HOST` in `scripts/serve.mjs`.

**Secrets location:**
- No server secrets. Generated Nostr secret keys are stored in browser `localStorage` under the identity storage key defined in `src/config/relays.ts`.

## Webhooks & Callbacks

**Incoming:**
- None. Relay messages arrive over client-initiated WebSocket subscriptions handled in `src/nostr/transport.ts`.

**Outgoing:**
- Nostr `REQ`, `CLOSE`, and `EVENT` WebSocket messages sent to configured relays by `src/nostr/transport.ts`.

---

*Integration audit: 2026-08-14*
