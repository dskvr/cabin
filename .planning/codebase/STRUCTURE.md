# Codebase Structure

**Analysis Date:** 2026-08-14

## Directory Layout

```text
cabin/
├── public/                 # Static HTML and CSS shell
├── scripts/                # Build, serve, and test scripts
├── src/
│   ├── app/                # Application controller and hash router
│   ├── config/             # Relay/configuration constants
│   ├── domain/             # Business rules, types, validation
│   ├── nostr/              # Nostr protocol, identity, repository, transport
│   ├── ui/                 # HTML helpers and motion
│   ├── main.ts             # Browser bootstrap
│   └── site-data.ts        # Site/project content data
├── tests/                  # Node-based core, integration, and UI tests
└── docs/                   # Acceptance, decisions, verification, references
```

## Directory Purposes

**`src/app/`:** Stateful application orchestration in `src/app/App.ts` and routing in `src/app/router.ts`.

**`src/domain/`:** Keep pure calculations and contracts in `src/domain/elo.ts`, `src/domain/timer.ts`, `src/domain/follows.ts`, `src/domain/export.ts`, `src/domain/utils.ts`, and `src/domain/types.ts`.

**`src/nostr/`:** Protocol boundaries: cryptography/bech32, event builders/parsers/indexing, identity/profile/zap services, repository and transport.

**`src/ui/`:** Safe markup and browser visual effects in `src/ui/html.ts` and `src/ui/motion.ts`.

**`public/`:** Static entry document `public/index.html` and global stylesheet `public/styles.css`.

**`scripts/`:** ESM tooling in `scripts/build.mjs`, `scripts/serve.mjs`, and `scripts/test.mjs`.

**`tests/`:** Test suites are separate from implementation: `tests/core.test.mjs`, `tests/integration.test.mjs`, and `tests/ui-theme.test.mjs`.

## Key File Locations

**Entry Points:** `src/main.ts`, `public/index.html`

**Configuration:** `src/config/relays.ts`, `.nsite/config.json`

**Core Logic:** `src/app/App.ts`, `src/domain/`, `src/nostr/repository.ts`

**Testing:** `tests/`, `scripts/test.mjs`, `docs/TESTING.md`

## Naming Conventions

**Files:** Lowercase kebab-free names with descriptive nouns (`src/event-parsers.ts`); the application class uses PascalCase filename `App.ts`.

**Directories:** Lowercase conceptual areas (`src/app`, `src/domain`, `src/nostr`, `src/ui`).

**Symbols:** PascalCase classes/interfaces, camelCase functions and variables, and private `#` fields/methods inside `DemoDayApp`/transport classes.

## Where to Add New Code

**New Feature:** Put orchestration and route/UI behavior in `src/app/App.ts`; put calculations/validation in `src/domain/`; put Nostr reads/writes behind `src/nostr/repository.ts`.

**New Component/Module:** Add a focused lowercase file under the owning area (`src/domain/`, `src/nostr/`, or `src/ui/`) and import it directly; no barrel directory is detected.

**Utilities:** Domain-independent markup helpers belong in `src/ui/html.ts`; validation helpers belong in `src/domain/utils.ts`; shared contracts belong in `src/domain/types.ts`.

**Tests:** Add or extend the relevant suite under `tests/`, matching `*.test.mjs` naming; use `tests/integration.test.mjs` for relay/repository behavior and `tests/core.test.mjs` for deterministic domain/protocol behavior.

## Special Directories

**`.codebase-memory/`:** Generated knowledge-graph artifacts; generated, not application source.

**`.nsite/`:** Site/deployment configuration in `.nsite/config.json`.

**`docs/`:** Project specifications and verification material; do not place runtime code here.

---

*Structure analysis: 2026-08-14*
