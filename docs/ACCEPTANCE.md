# Acceptance-criteria coverage

The product specification contains 32 completion criteria. The table below maps each criterion to the delivered implementation and verification.

| # | Criterion | Status and evidence |
|---:|---|---|
| 1 | Opening lists active demo days from the fixed relay pool. | Implemented in `NostrRepository.start()` and `DemoDayApp.#renderHome`; integration-tested with the equivalent in-memory transport. Live relay availability is an operational deployment check. |
| 2 | Cards show captain name from copied kind-`0`. | Implemented through repository profile lookup and profile fallbacks; integration test publishes and resolves copied captain profiles. |
| 3 | Cards show unique participant-entry count. | Derived from latest entry coordinates in `entriesForSession`; integration-tested with three participants. |
| 4 | Selecting a session pins its author as captain. | Hash route decodes `naddr` to exact kind/pubkey/`d`; repository accepts only that selected coordinate. |
| 5 | Display selection publishes no entry. | Display route is read-only and does not create an identity or entry; asserted by the integration flow. |
| 6 | A new browser generates and retains an ephemeral keypair. | `identity.ts` creates BIP-340 key material and saves `sedd.identity.v1`; the rendered-browser onboarding flow verified generation and local retention. |
| 7 | Onboarding asks for normal `npub`, not manual profile fields. | Profile-import UI has one `npub` field and no name/picture/bio inputs. |
| 8 | Complete source kind-`0` content and tags are copied. | `copyProfileToEphemeralKey` clones tags and preserves raw content byte-for-byte; unit-tested. |
| 9 | Missing profile prompts for another relay. | Implemented with validated `wss://` fallback form. |
| 10 | App never asks user to republish normal profile. | No such path or message exists; fallback is relay lookup only. |
| 11 | Participant publishes one replaceable entry with real key, demo, ranking, feedback. | Schema/parser/builder implemented and unit/integration-tested. |
| 12 | Editing replaces the same entry coordinate. | All entry writes use the same author plus `sedd-entry:<session-d>` coordinate. |
| 13 | Captain also has an ordinary participant entry. | Create flow publishes session and captain entry; both the integration suite and rendered-browser captain creation flow verify the result. |
| 14 | Captain selects any unpresented demo and presses GO. | Captain picker excludes presented authors and GO replaces session current-demo state. |
| 15 | Every client shows latest selected name/description. | Current view resolves the latest participant coordinate; replacement index is tested. |
| 16 | Captain starts timer with one session timestamp. | START/RESTART set only `timer_started_at_ms`; integration-tested across clients. |
| 17 | Six-minute presentation, two-minute questions, then overtime. | Pure timer implementation and boundary tests. |
| 18 | No timer event or heartbeat. | Only the session replacement carries the start timestamp. |
| 19 | DONE records start/finish and enables feedback/ranking. | DONE appends a run and clears current state; UI gates feedback/ranking on completed runs. |
| 20 | Rankings become pairwise preferences. | `calculateElo` enumerates all ranked pairs. |
| 21 | Clients compute identical Elo from latest entries/presentation order. | Pure deterministic calculation; two-client integration equality assertion. |
| 22 | Leaderboard updates when ranking changes. | Entry replacement triggers repository change/render and full Elo recalculation. |
| 23 | Zap uses real `p` and entry-address `a`. | Custom zap builder and receipt validation; unit-tested. |
| 24 | Zaps never affect Elo. | Elo input contains only presentation order and entry rankings; unit/UI note. |
| 25 | Close stores final Elo and exact snapshot IDs. | Close flow refreshes state and publishes all three snapshot arrays; integration-tested. |
| 26 | Closed sessions disappear from active list. | `activeSessions()` filters `closed_at_ms`; integration-tested. |
| 27 | Closed summary downloads normalized JSON plus raw signed events. | Strict snapshot reconstruction and `buildExport`; unit/integration-tested. |
| 28 | JSON contains no secret key. | Recursive export guard and explicit tests for secret fields/`nsec`. |
| 29 | Follow suggestions use only real pubkeys. | Suggestions are derived from `entry.real_pubkey`; unit-tested. |
| 30 | Viewer and already-followed accounts are excluded. | Kind-`3` `p`-tag comparison, dedupe, and self-exclusion; unit-tested. |
| 31 | Missing follow list prompts for another relay. | Closed-summary fallback form stores successful account-specific relay. |
| 32 | No relay settings, roster, schedule, co-presenter, or open/live split. | Intentionally omitted; only the two specified kind-`30078` shapes exist. |
