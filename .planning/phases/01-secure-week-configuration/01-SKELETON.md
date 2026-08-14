# Walking Skeleton — Captain's Cabin

**Phase:** 1
**Generated:** 2026-08-14

## Capability Proven End-to-End

> A manifest-assigned captain can edit a local week draft, deliberately publish one signed Nostr configuration, and read the verified configuration back through the application.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Existing vanilla TypeScript SPA and full-root renderer | Preserves the working browser-only application, strict compiler, hash routing, and escaped HTML component conventions. |
| Data layer | Versioned public week configuration in captain-authored Nostr kind `30078` events, indexed through `NostrRepository` | Nostr is the established persistence boundary; deterministic `d` coordinates provide replaceable week state without adding a conventional database. |
| Auth | Local Nostr signing identity plus manifest-derived captain/week authorization in builders, parsers, and repository reads | Cryptographic verification proves authorship; semantic checks bind that author to the designated captain and derived week. |
| Deployment target | Existing static `npm run build` output and `npm run dev` local execution path | Phase 1 requires no backend process or hosting change. |
| Directory layout | Deployment input in `src/config`, pure policy in `src/domain`, signed codecs/retrieval in `src/nostr`, orchestration in `src/app`, escaped controls in `src/ui` | Matches the repository's current dependency boundaries and keeps relay access out of presentation code. |

## Stack Touched in Phase 1

- [x] Project scaffold — existing TypeScript build, strict check, and Node test runner retained
- [x] Routing — assigned-week setup is reachable through the existing hash-routed SPA
- [x] Persistence — one real signed Nostr write and verified repository read at the manifest-derived coordinate
- [x] UI — one local edit and deliberate publish action wired to persistence
- [x] Deployment — existing `npm run dev`, `npm run build`, and static output remain the execution path

## Out of Scope (Deferred to Later Slices)

- Participant proposal submission, amendment, encrypted delivery, and whitelist enforcement
- Private schedule assembly and explicit public schedule publication
- Read-only archive and configuration-only cloning
- Participant availability, publication history, advanced forms, and expanded event operations

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without replacing its Nostr identity, repository, or static-browser boundaries:

- Phase 2: Whitelisted participants privately submit and amend captain-readable proposals.
- Phase 3: Captains assemble private schedules and deliberately publish a safe public projection.
- Phase 4: Captains browse read-only week history and clone configuration into fresh weeks.
