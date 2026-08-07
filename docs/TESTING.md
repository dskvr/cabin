# Testing and verification

## Automated commands

Run the complete local verification pipeline:

```bash
npm install
npm run verify
npm run build
```

`npm run verify` performs strict TypeScript checking, a clean build, and all Node tests.

## Automated coverage

### Cryptography and encoding

- BIP-340 signing and verification of Nostr events.
- Event hash/content tamper detection.
- NIP-19 `npub`, `nsec`, and `naddr` round trips.

### Event model and repository behavior

- Newer replaceable events win.
- Equal timestamps select the lexicographically lower event ID.
- Duplicate event IDs are ignored.
- Complete kind-`0` content and tags are copied exactly.
- Session and participant event builders produce signed, parseable records.
- Blank Lightning fields do not create a zap redirect tag.

### Pure domain behavior

- Presentation, questions, and overtime boundaries.
- Time splitting for final summaries.
- Deterministic Elo pair order.
- Incomplete rankings and presenter exclusion.
- Follow suggestions exclude self, duplicates, malformed keys, and existing follows.
- Export contains normalized records and raw signed events.
- Export contains no `nsec` or known secret-key field.
- Harmless custom profile fields such as `private_notes` remain allowed.

### Zaps

- Kind-`9734` uses the real presenter pubkey in `p`.
- The `a` tag targets the ephemeral participant-entry coordinate.
- Receipt and embedded request signatures are checked.
- Target, kind, amount, service author, and duplicate receipt handling are checked.
- Common BOLT11 amount multipliers are parsed.

### Multi-client integration

The in-memory integration test simulates a captain repository and a second observer/display repository through:

1. copied profiles;
2. captain session creation;
3. three participant entries;
4. active-session discovery and participant counting;
5. GO and one-timestamp timer propagation;
6. three completed demonstrations;
7. feedback and rankings;
8. identical Elo on both clients;
9. closure with exact entry/profile snapshot IDs;
10. active-session removal;
11. exact snapshot retrieval;
12. AI-ready export with final Elo and feedback.

## Browser runtime verification performed for this delivery

A headless Chromium runtime loaded the built ES modules and production stylesheet with the in-memory transport. The browser checks exercised:

- application bootstrap without page or console errors;
- the home/discovery view;
- navigation to `#/create`;
- generation and local retention of `sedd.identity.v1`;
- rendering and submission of the normal-`npub` profile-import form;
- discovery of a seeded, signed normal-account kind-`0` profile;
- exact profile copying under the ephemeral key;
- rendered captain demo-day and project forms;
- captain session creation and navigation to its `naddr` route;
- observation of the expected publication sequence: kind `0` source profile, copied kind `0`, captain session kind `30078`, and captain entry kind `30078`;
- rendering of the resulting captain session with one participant and one project.

The static server was separately checked for successful responses for `index.html`, CSS, the main module, nested modules, and the favicon.

The execution environment blocks direct browser navigation to local HTTP/file URLs by administrator policy. The browser runtime checks therefore loaded the same built modules through browser-created blob URLs. This verifies module evaluation, form handling, repository integration, signing, and rendering, while HTTP serving was verified independently. Because the blob document has an opaque origin, the harness provided a deterministic SHA-256 bridge; Node tests independently verify event hashes, BIP-340 signing/verification, tamper rejection, and secp256k1 public-key derivation against Node's curve implementation.

## Live operational checks before an event

The automated suite deliberately does not publish test data to the ten public relays or request real Lightning invoices. Before an actual demo day, verify from the deployment origin:

- multiple fixed relays accept kind-`30078` and kind-`0` events;
- at least one fixed relay remains reachable during a simulated relay outage;
- normal participant profiles are discoverable;
- any account-specific fallback relay is reachable over `wss://`;
- presenter LNURL endpoints allow browser CORS requests;
- LNURL metadata advertises Nostr zap support and a valid service pubkey;
- a low-value zap produces a kind-`9735` receipt on the requested relays;
- the display device clock is reasonably synchronized;
- the static host allows all fixed WebSocket relay destinations and HTTPS LNURL destinations under its CSP/firewall policy.
