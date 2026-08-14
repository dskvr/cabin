# Sovereign Engineering Captain’s Cabin

A static, backend-free Nostr application for running a Sovereign Engineering cohort. Captains configure each week, collect encrypted proposals, privately assemble Tuesday talks and Wednesday workshops, deliberately publish a safe public schedule, and archive completed weeks for later reuse. The existing Demo Day tools provide configurable presentation and question timers, participant entries, feedback, rankings, Elo, presenter zaps, signed snapshots, and JSON exports.

The authoritative product specification and the original implementation plan are included under [`docs/reference/`](docs/reference/).

## Make the homepage show this week

If the homepage says **“The public week configuration has not been published yet,”** the site is built correctly, but the assigned captain has not published that week to Nostr yet.

1. Confirm the captain’s exact NIP-07 account npub is assigned to the current `week_number` in [`src/config/cohort.ts`](src/config/cohort.ts). Changing this file requires rebuilding and redeploying the site.
2. Select **Login with NIP-07** in the header and approve that same account. The header should show the extension account, not a browser-generated Demo Day identity.
3. Select **Week setup** in the footer. The app automatically opens the week assigned to the signed-in captain.
4. Fill the required theme and public description. Add or edit the Tuesday talks, Wednesday workshops, locations, links, proposal fields, and Friday timing as needed.
5. Clear every **Needs attention** item in the Readiness panel.
6. Select **Create week** and approve the NIP-07 signature. Existing weeks use **Publish changes** instead. This is the action that publishes the signed week configuration to the fixed Nostr relays.
7. Return to **Cohort week**. The Monday–Friday homepage will load the published theme, description, activities, and Demo Day timing from Nostr.
8. Open Friday or select **I AM THE CAPTAIN NOW** to create the Demo Day. This action is only available after the week configuration exists.

Publishing a week does not publish the detailed Tuesday/Wednesday presenter lineup. After accepting proposals and arranging the private schedule, use **Save private schedule**, then **Publish public schedule** to make those session details public.

If **Week setup** says the identity has no assigned week, the extension is exposing a different npub from the one compiled into `captains`. Log out, switch accounts in the extension, and log in again. If signing succeeds but the homepage stays blank, check the relay indicator and use **Publish changes** again; failed relay deliveries remain queued locally for retry.

## Configure a cohort

Cohort configuration is compiled into the static site from [`src/config/cohort.ts`](src/config/cohort.ts). Update it before building:

```ts
export const COHORT_MANIFEST = {
  v: 1,
  cohort_id: "madeira-2026",
  start_date: "2026-08-12",
  end_date: "2026-09-08",
  starting_week: 1,
  captains: [
    { week_number: 1, npub: "npub1..." },
    { week_number: 2, npub: "npub1..." },
  ],
  participant_allowlist: [
    "npub1...",
    "npub1...",
  ],
} as const;
```

- `cohort_id` is a lowercase identifier containing letters, numbers, and hyphens.
- `start_date` and `end_date` are inclusive ISO calendar dates. Week assignments and labels are derived from this range.
- `starting_week` defaults to `1` and offsets the first week number when an earlier cohort week did not use the site.
- Each captain entry assigns one signing npub to one week. A captain may change their week’s theme, activities, form, locations, links, and Demo Day timing.
- `participant_allowlist` contains the signing npubs allowed to submit proposals.
- Atlantic/Madeira is the only supported timezone.

Captain’s Cabin uses the account selected in a NIP-07 browser extension. To collect the correct npubs:

1. Ask each captain and participant for the npub of the Nostr account they will select in their NIP-07 extension.
2. Put captain npubs under `captains` and participant npubs under `participant_allowlist`.
3. Rebuild and deploy the site.

The extension’s private key never enters the site. The existing Demo Day subsystem still creates a separate browser-local identity for its session and participant records, but that local npub does not grant Captain’s Cabin access and must not be placed in the cohort manifest.

## Run locally

### Prerequisites

- Node.js 20.19 or newer.
- TypeScript 5.8.3, installed through the locked npm dependencies. The checked-in `dist/` directory can be served without installing build dependencies.
- A modern browser with WebSocket, Web Crypto, `localStorage`, and ES module support.
- A NIP-07 extension for Captain’s Cabin. Captain inbox access also requires the extension’s NIP-44 decrypt capability.

```bash
npm ci
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

`npm run dev` performs a build, watches TypeScript and public assets, and reloads connected development browsers. `npm run preview` serves the existing `dist/` directory and builds only when `dist/index.html` is missing.

## Operate Captain’s Cabin

### Captain workflow

1. Select **Login with NIP-07** in the header and approve access to the configured captain account.
2. Open **Week setup**. The first relay lookup may take up to four seconds.
3. Configure the public theme and description, Tuesday and Wednesday activities, proposal fields, locations, links, and Demo Day timing. Defaults are six presentation minutes and two question minutes.
4. Complete every item marked **Needs attention**. In a new week, the public description is intentionally blank and must be filled before publishing.
5. Select **Create week** at the bottom of the readiness panel and approve the NIP-07 signature. Later edits use **Publish changes**. Editing remains local until this explicit action.
6. After the week exists, open **I AM THE CAPTAIN NOW** to create its Demo Day. Demo Day creation is blocked until the week configuration has been published.
7. Return to **Week setup** and select **Open intake** when the proposal form is ready. A later signed configuration can close intake.
8. Use **Refresh inbox** to retrieve and decrypt valid participant proposals.
9. Accept or reject each proposal. Accepted proposals can be assigned manually to an activity and time slot with captain-selected public title, presenter, and description.
10. Review warnings for overlaps, duplicate placements, rejected/unaccepted placements, and times outside activity bounds.
11. Select **Save private schedule**. This encrypts the decisions and working schedule to the captain; it does not publish a public schedule.
12. Select **Publish public schedule** only when the safe public projection is ready. Public pages never render proposal answers, rejections, or private draft state.
13. Select **Complete and archive week** when finished. The first valid archive pins the completed configuration and public schedule as read-only history.

An assigned captain can clone any available prior configuration into their current week. Cloning is local until published, creates fresh activity and proposal-field identifiers, resets intake and status, and never copies proposals, decisions, placements, participants, encryption state, or publication state.

### Participant workflow

1. Select **Login with NIP-07** in the header using an account present in `participant_allowlist`, then open **Week setup**.
2. Complete the captain-defined form while intake is open.
3. Select **Submit private proposal**. Updates use the same author-bound proposal identifier and are accepted only while intake remains open.
4. Watch the success or error notice for relay delivery status.

Only a captain-addressed encrypted gift wrap is sent to relays. Relay-visible tags do not identify the participant or expose the cohort, week, form fields, or answers. Proposal state is not synchronized back to other participant devices.

### Public schedules and archives

Published schedules appear on the home page without captain or participant authorization. Public events use a separate, strictly validated schema containing only the activity data and presenter/session fields deliberately selected by the captain. Completed weeks render as read-only archives.

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
│   ├── cohort weeks, proposals, schedules, and archives
│   ├── Elo and pairwise results
│   ├── follow suggestions
│   └── normalized/raw JSON export
├── Nostr repository
│   ├── BIP-340 event signing and verification
│   ├── NIP-44 private proposal and schedule encryption
│   ├── NIP-19 npub/nsec/naddr/LNURL encoding
│   ├── event schema validation
│   ├── replaceable-event resolution
│   ├── subscriptions and reconnects
│   └── optimistic publishing with a local retry queue
├── localStorage
│   ├── unencrypted ephemeral identity
│   ├── remembered NIP-07 public key
│   ├── normal-account association
│   ├── account-specific lookup relays
│   └── pending signed publications
└── seven fixed Nostr relays
```

Protocol and domain code are kept out of the rendering layer. `NostrRepository` is the boundary between the application and either the real WebSocket transport or the in-memory test transport.

## Source layout

```text
src/
├── app/       routes, rendering, and user interactions
├── config/    protocol constants and fixed relay pool
├── domain/    cohort, Cabin workflows, timer, Elo, follows, and export
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

- Captain’s Cabin requests signatures and NIP-44 decryption through NIP-07. The account’s private key remains inside the extension and is never requested, stored, or exposed by the site.
- The ephemeral `nsec` is stored unencrypted in `localStorage`, as required by the specification.
- The ephemeral secret is not placed in routes, protocol events, logs, or exports.
- Proposal content and private schedules use authenticated NIP-44 encryption. Only captain-addressed gift wraps are published; the relay sees the captain recipient, event timing, and encrypted payload size.
- Proposal events are accepted only when the inner signature matches the author-bound proposal ID, the author is whitelisted, the referenced captain configuration is signed and current at submission time, and intake is open.
- Private schedule events and all public/archive events require the assigned captain’s signature.
- Public schedule parsing uses an exact allowlist and rejects extra fields before rendering.
- The first valid archive is immutable and pins its completed configuration against later replacement events.
- Export generation recursively rejects known secret-key field names and any encoded `nsec` value while preserving unrelated custom profile fields.
- Every received event is shape-checked, hash-checked, and BIP-340 signature-checked before it can enter application state.
- A selected session route pins the captain's pubkey and `d` identifier; only that exact coordinate can update the selected session.
- A closed export is built only from the event IDs recorded in the final session replacement. Missing or invalid snapshot events disable export rather than silently substituting newer relay state.

## Deployment

Run the complete release check and build:

```bash
npm run check
npm run build
npm test
```

Upload the contents of `dist/` to any static HTTPS host. Hash routing means no server-side rewrite rules are required. The host must allow browser WebSocket connections to the fixed relay list and HTTPS requests to participants’ LNURL endpoints.

Before deployment, confirm:

- Cohort dates, `starting_week`, captain assignments, and participant allowlist are final.
- Every configured captain and participant npub matches the account they will select in their NIP-07 extension.
- Each captain’s extension supports NIP-07 event signing and NIP-44 decryption.
- At least one configured relay accepts and returns signed configuration, gift-wrap, public schedule, and archive events.
- Captain and participant browsers have accurate clocks and persistent `localStorage`.
- The generated `dist/` build is the one uploaded to the host.

Before a real event, perform the operational checks in [`docs/TESTING.md`](docs/TESTING.md), especially relay write acceptance, profile visibility, LNURL CORS behavior, NIP-57 support, and front-display clock synchronization.

## Implementation notes

The supplied implementation plan recommended React and `@nostr/tools`. The build environment used for this delivery could not access a package registry, so the application uses dependency-free TypeScript and a small DOM renderer, with self-contained Nostr primitives. This preserves the specified static/no-backend architecture and makes the checked-in application runnable without runtime packages. The rationale and every other material decision are recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md). See also the [`acceptance-criteria map`](docs/ACCEPTANCE.md) and the [`delivery verification record`](docs/VERIFICATION.md).
