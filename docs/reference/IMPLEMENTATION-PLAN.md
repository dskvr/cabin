# Sovereign Engineering Demo Day Tracker — Implementation Plan

## Recommended implementation

Build it as a **static React + TypeScript application** with no application server and no database:

```text
Browser
 ├── React UI
 ├── Domain logic
 │    ├── timer
 │    ├── Elo
 │    ├── follow suggestions
 │    └── JSON export
 ├── Nostr repository
 │    ├── event validation
 │    ├── replaceable-event resolution
 │    ├── subscriptions
 │    └── publishing
 ├── localStorage
 │    ├── ephemeral nsec
 │    ├── real npub
 │    └── added profile relays
 └── 10 hardcoded Nostr relays
```

Use Vite with the React TypeScript template and `@nostr/tools`. Vite supports a static React/TypeScript build, while the current `@nostr/tools` package provides key generation, event signing, validation, NIP-19 encoding, and a `SimplePool` for multi-relay subscriptions and publishing.

## 1. Project setup

```bash
npm create vite@latest sovereign-demo-day -- --template react-ts
cd sovereign-demo-day
npm install

npx jsr add @nostr/tools

npm install react-router-dom qrcode
npm install -D @types/qrcode vitest @testing-library/react \
  @testing-library/jest-dom playwright
```

Use a hash router so the application can be deployed to any static host without configuring server-side URL rewrites:

```text
/#/
/#/session/<naddr>
/#/display/<naddr>
```

Do not add Redux, a backend API, an ORM, authentication middleware, or a separate database.

## 2. Suggested source structure

```text
src/
├── app/
│   ├── App.tsx
│   ├── Router.tsx
│   └── AppProvider.tsx
│
├── config/
│   └── relays.ts
│
├── domain/
│   ├── types.ts
│   ├── session.ts
│   ├── timer.ts
│   ├── elo.ts
│   ├── follows.ts
│   └── export.ts
│
├── nostr/
│   ├── pool.ts
│   ├── identity.ts
│   ├── event-index.ts
│   ├── event-builders.ts
│   ├── event-parsers.ts
│   ├── profiles.ts
│   ├── repository.ts
│   └── zaps.ts
│
├── pages/
│   ├── HomePage.tsx
│   ├── SessionPage.tsx
│   ├── DisplayPage.tsx
│   └── SummaryPage.tsx
│
├── components/
│   ├── ActiveDemoDayCard.tsx
│   ├── ProfileImport.tsx
│   ├── DemoForm.tsx
│   ├── CurrentDemo.tsx
│   ├── Timer.tsx
│   ├── CaptainControls.tsx
│   ├── RankingEditor.tsx
│   ├── Leaderboard.tsx
│   ├── FeedbackForm.tsx
│   ├── ZapButton.tsx
│   └── FollowSuggestions.tsx
│
└── main.tsx
```

Keep protocol logic out of React components. Components should receive already-parsed session, participant, ranking, and zap data.

## 3. Hardcoded relay pool

Keep the ten relay addresses in one compile-time constant:

```ts
// src/config/relays.ts

export const DEFAULT_RELAYS = [
  "wss://relay.nostr.com",
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.snort.social",
  "wss://nostr.bitcoiner.social",
  "wss://nostr.mom",
  "wss://relay.nostr.band",
  "wss://offchain.pub",
  "wss://purplepag.es",
] as const;

export const APP_KIND = 30078;
export const PROFILE_KIND = 0;
export const FOLLOW_KIND = 3;

export const PRESENTATION_MS = 6 * 60 * 1000;
export const QUESTIONS_MS = 2 * 60 * 1000;
```

Create exactly one `SimplePool` for the whole application:

```ts
// src/nostr/pool.ts

import { SimplePool } from "@nostr/tools/pool";

export const pool = new SimplePool({
  enableReconnect: true,
});

pool.trackRelays = true;
```

`SimplePool` opens and reuses relay connections, supports multi-relay queries and publishing, and can automatically reconnect. Its `trackRelays` option records which relays supplied a given event, which is useful when saving the source relay for an imported real profile.

Treat publication as successful after the first relay accepts the event:

```ts
export async function publishToDefaultRelays(event: NostrEvent): Promise<void> {
  await Promise.any(
    pool.publish([...DEFAULT_RELAYS], event, {
      maxWait: 4_000,
    }),
  );
}
```

Continue sending to all relays, but do not make the user wait for all ten.

## 4. Local identity

Generate the ephemeral key when the user first needs to join or create a demo day.

```ts
// src/nostr/identity.ts

import {
  generateSecretKey,
  getPublicKey,
} from "@nostr/tools/pure";
import {
  decode,
  nsecEncode,
  npubEncode,
} from "@nostr/tools/nip19";

const STORAGE_KEY = "sedd.identity.v3";

export interface LocalIdentity {
  version: 3;
  nsec: string;
  npub: string;
  publicKey: string;

  realNpub: string | null;
  realPublicKey: string | null;

  sourceProfileEventId: string | null;
  sourceProfileRelay: string | null;
  addedProfileRelays: string[];
}

export function createIdentity(): LocalIdentity {
  const secretKey = generateSecretKey();
  const publicKey = getPublicKey(secretKey);

  const identity: LocalIdentity = {
    version: 3,
    nsec: nsecEncode(secretKey),
    npub: npubEncode(publicKey),
    publicKey,
    realNpub: null,
    realPublicKey: null,
    sourceProfileEventId: null,
    sourceProfileRelay: null,
    addedProfileRelays: [],
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function getSecretKey(identity: LocalIdentity): Uint8Array {
  const decoded = decode(identity.nsec);

  if (decoded.type !== "nsec") {
    throw new Error("Stored identity does not contain a valid nsec");
  }

  return decoded.data;
}
```

Store `npub` and `nsec` for display and input, but convert public keys to hexadecimal before using them in events or filters. NIP-19 specifies that `npub` and `nsec` are human-facing encodings rather than values used inside core event structures.

Do not place the identity into:

- URL parameters
- Analytics
- Application logs
- JSON exports
- Error-reporting payloads

Security may not be a concern, but accidentally exporting every participant’s `nsec` would still be undesirable.

## 5. Domain types

Use two application record shapes.

```ts
// src/domain/types.ts

export interface PresentedDemo {
  pubkey: string;
  started_at_ms: number;
  finished_at_ms: number;
}

export interface EloResult {
  rank: number;
  pubkey: string;
  rating: number;
}

export interface SessionState {
  v: 1;
  type: "session";

  name: string;
  created_at_ms: number;
  closed_at_ms: number | null;

  current_demo: string | null;
  timer_started_at_ms: number | null;

  presented: PresentedDemo[];

  final_elo: EloResult[] | null;
  snapshot_entry_ids: string[] | null;
  snapshot_zap_ids: string[] | null;
}

export interface DemoFeedback {
  liked: string;
  learned: string;
}

export interface ParticipantEntry {
  v: 3;
  type: "entry";

  real_pubkey: string;
  source_profile_event_id: string;
  source_profile_relay: string;

  demo: {
    name: string;
    description: string;
    link: string | null;
  };

  ranking: string[];
  feedback: Record<string, DemoFeedback>;

  updated_at_ms: number;
}
```

The `ranking` array and `feedback` keys use ephemeral pubkeys because ephemeral pubkeys identify demos within the session.

The `real_pubkey` is used for:

- Imported-profile provenance
- Presenter zaps
- End-of-day follow suggestions
- Opening the participant in a normal Nostr client

## 6. Event indexing and replacement

Do not rely on the order in which events arrive from relays.

Maintain one in-memory index of the latest event for each replaceable coordinate:

```ts
// src/nostr/event-index.ts

import type { Event } from "@nostr/tools/pure";

function getTag(event: Event, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

export function eventCoordinate(event: Event): string {
  if (event.kind >= 30_000 && event.kind < 40_000) {
    return `${event.kind}:${event.pubkey}:${getTag(event, "d") ?? ""}`;
  }

  return `${event.kind}:${event.pubkey}`;
}

export function eventIsNewer(
  candidate: Event,
  current: Event | undefined,
): boolean {
  if (!current) return true;

  if (candidate.created_at !== current.created_at) {
    return candidate.created_at > current.created_at;
  }

  return candidate.id < current.id;
}

export class EventIndex {
  private events = new Map<string, Event>();

  ingest(event: Event): boolean {
    const key = eventCoordinate(event);
    const current = this.events.get(key);

    if (!eventIsNewer(event, current)) {
      return false;
    }

    this.events.set(key, event);
    return true;
  }

  get(key: string): Event | undefined {
    return this.events.get(key);
  }

  values(): Event[] {
    return [...this.events.values()];
  }
}
```

Kind `30078` is an addressable application-data event. Its identity is `kind + author + d`, and the latest event at that coordinate replaces the previous value. NIP-01 also defines the lower event ID as the winner when two replaceable events have the same timestamp.

### Avoid future timestamps

Do not handle rapid replacements by continually assigning timestamps in the future.

Instead, serialize writes to each coordinate and wait until the next second when necessary:

```ts
const queues = new Map<string, Promise<void>>();

export function enqueueReplacement(
  coordinate: string,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = queues.get(coordinate) ?? Promise.resolve();

  const next = previous
    .catch(() => undefined)
    .then(operation);

  queues.set(coordinate, next);
  return next;
}
```

Before signing:

```ts
const now = Math.floor(Date.now() / 1000);
const previousTimestamp = previousEvent?.created_at ?? 0;

if (now <= previousTimestamp) {
  await new Promise((resolve) =>
    setTimeout(resolve, (previousTimestamp - now + 1) * 1000),
  );
}
```

For ranking changes, update the UI immediately but debounce the relay publication for approximately 500–800 milliseconds.

## 7. Event builders

### Session event

```ts
import { finalizeEvent } from "@nostr/tools/pure";

export function buildSessionEvent(
  sessionD: string,
  state: SessionState,
  secretKey: Uint8Array,
  createdAt: number,
) {
  return finalizeEvent(
    {
      kind: 30078,
      created_at: createdAt,
      tags: [
        ["d", sessionD],
        ["t", "sedd-session"],
      ],
      content: JSON.stringify(state),
    },
    secretKey,
  );
}
```

### Participant entry

```ts
export function buildEntryEvent(
  sessionAddress: string,
  sessionD: string,
  entry: ParticipantEntry,
  secretKey: Uint8Array,
  createdAt: number,
) {
  return finalizeEvent(
    {
      kind: 30078,
      created_at: createdAt,
      tags: [
        ["d", `sedd-entry:${sessionD}`],
        ["t", "sedd-entry"],
        ["a", sessionAddress],
        [
          "p",
          entry.real_pubkey,
          entry.source_profile_relay,
          "presenter",
        ],
        [
          "zap",
          entry.real_pubkey,
          entry.source_profile_relay,
          "1",
        ],
      ],
      content: JSON.stringify(entry),
    },
    secretKey,
  );
}
```

NIP-78 reserves kind `30078` for addressable arbitrary application state, so using it for both the captain’s session state and each participant’s session entry is appropriate.

## 8. Event parsing

Do not cast untrusted JSON directly to TypeScript interfaces.

Write two small parsers:

```ts
export function parseSessionEvent(
  event: Event,
): SessionState | null {
  if (event.kind !== 30078) return null;

  try {
    const value: unknown = JSON.parse(event.content);

    if (
      typeof value !== "object" ||
      value === null ||
      (value as { type?: unknown }).type !== "session" ||
      (value as { v?: unknown }).v !== 1
    ) {
      return null;
    }

    // Validate the remaining required properties.
    return value as SessionState;
  } catch {
    return null;
  }
}
```

Repeat this for `ParticipantEntry`.

Because there are only two app-specific shapes, manual validation is simpler than introducing a schema library.

Always validate:

- Event kind
- Signature
- `d` tag
- `t` tag
- Session `a` tag
- Expected captain author
- Content version
- Required property types

`SimplePool` verifies events by default, but explicit domain validation is still required because a correctly signed event can contain malformed application content.

## 9. Discovery screen

Create two long-lived subscriptions when the application starts.

```ts
const sessionsSubscription = pool.subscribe(
  [...DEFAULT_RELAYS],
  {
    kinds: [30078],
    "#t": ["sedd-session"],
  },
  {
    onevent: ingestEvent,
  },
);

const entriesSubscription = pool.subscribe(
  [...DEFAULT_RELAYS],
  {
    kinds: [30078],
    "#t": ["sedd-entry"],
  },
  {
    onevent: ingestEvent,
  },
);
```

Single-letter tags such as `t` and `a` are expected to be indexed by relays, allowing filters such as `#t` and `#a`.

Derive active sessions from the latest session events:

```ts
const activeSessions = sessionEvents
  .map(parseSessionEvent)
  .filter(
    (session): session is SessionState =>
      session !== null && session.closed_at_ms === null,
  );
```

For each active session:

1. Fetch the captain’s copied kind-`0` profile using the session event author.
2. Group entries by their `a` session tag.
3. Count unique valid entry authors.
4. Resolve the current demo’s entry when one is selected.

The discovery card is derived entirely from relay state:

```text
Demo-day name
Captain name and avatar
Number of participants
Current demo or “Between demonstrations”
```

No additional discovery event is required.

## 10. Authorizing the captain

When a user selects a session, encode its address as an `naddr` in the route:

```ts
import { naddrEncode } from "@nostr/tools/nip19";

const naddr = naddrEncode({
  kind: 30078,
  pubkey: sessionEvent.pubkey,
  identifier: sessionD,
  relays: [...DEFAULT_RELAYS].slice(0, 3),
});
```

On the session page:

1. Decode the `naddr`.
2. Store the author pubkey and `d` identifier.
3. Query the session.
4. Accept only replacements matching the same author, kind, and `d`.

```ts
function isAuthorizedSessionUpdate(
  event: Event,
  captainPubkey: string,
  sessionD: string,
): boolean {
  return (
    event.kind === 30078 &&
    event.pubkey === captainPubkey &&
    getTag(event, "d") === sessionD
  );
}
```

The display computer uses exactly the same mechanism. Selecting a session authorizes that event author as captain for that selected session.

## 11. Profile import

### Lookup flow

When joining or creating a demo day:

1. Ask for the participant’s usual `npub`.
2. Decode it to hex.
3. Search the ten default relays.
4. If missing, show a relay URL input.
5. Search the added relay.
6. Save a successful relay locally.
7. Republish the exact profile under the ephemeral key.

```ts
export async function findProfile(
  realPubkey: string,
  additionalRelays: string[],
): Promise<{ event: Event; relay: string } | null> {
  const relays = [
    ...new Set([...DEFAULT_RELAYS, ...additionalRelays]),
  ];

  const events = await pool.querySync(
    relays,
    {
      kinds: [0],
      authors: [realPubkey],
      limit: 1,
    },
    {
      maxWait: 4_000,
    },
  );

  const profile = events.sort((a, b) => {
    if (a.created_at !== b.created_at) {
      return b.created_at - a.created_at;
    }
    return a.id.localeCompare(b.id);
  })[0];

  if (!profile) return null;

  const sourceRelay =
    [...(pool.seenOn.get(profile.id) ?? [])][0]?.url ??
    additionalRelays[0] ??
    DEFAULT_RELAYS[0];

  return {
    event: profile,
    relay: sourceRelay,
  };
}
```

### Republish the entire profile

Copy the original content string and all tags exactly:

```ts
export function copyProfileToEphemeralKey(
  source: Event,
  ephemeralSecretKey: Uint8Array,
  createdAt: number,
) {
  return finalizeEvent(
    {
      kind: 0,
      created_at: createdAt,
      tags: source.tags.map((tag) => [...tag]),
      content: source.content,
    },
    ephemeralSecretKey,
  );
}
```

Do not reconstruct the JSON from known profile properties. Copying the raw content preserves unknown or future profile fields. Kind `0` permits extra metadata fields beyond the common `name`, `about`, and `picture` values.

When rendering the profile:

```ts
const displayName =
  profile.display_name ||
  profile.name ||
  shortenNpub(realNpub);
```

The imported `nip05` may not verify against the ephemeral key. Treat it as imported display data and link all follow and social actions to the real pubkey.

## 12. Joining a session

After profile import, ask only for:

```text
Demo name
Description
Optional link
```

Then publish:

1. Copied ephemeral kind-`0`.
2. Participant entry kind-`30078`.

Only show the participant as joined after at least one relay accepts both events.

The captain follows the same process. Captain controls become available when:

```ts
localIdentity.publicKey === selectedSessionCaptainPubkey
```

No separate captain role or permission event is required.

## 13. Session state updates

Implement one mutation helper:

```ts
async function mutateSession(
  update: (current: SessionState) => SessionState,
): Promise<void> {
  const currentEvent = repository.getSelectedSessionEvent();

  if (!currentEvent) {
    throw new Error("Current session event is missing");
  }

  if (currentEvent.pubkey !== identity.publicKey) {
    throw new Error("Only the session captain may update this session");
  }

  const currentState = parseSessionEvent(currentEvent);

  if (!currentState) {
    throw new Error("Invalid current session state");
  }

  const nextState = update(currentState);

  await publishSessionReplacement(nextState, currentEvent);
}
```

Captain actions become small state transitions.

### GO

```ts
mutateSession((session) => ({
  ...session,
  current_demo: selectedParticipantPubkey,
  timer_started_at_ms: null,
}));
```

### START TIMER

```ts
mutateSession((session) => ({
  ...session,
  timer_started_at_ms: Date.now(),
}));
```

### RESTART

Replace `timer_started_at_ms` with the new current time.

### DONE

```ts
mutateSession((session) => {
  if (!session.current_demo || !session.timer_started_at_ms) {
    return session;
  }

  return {
    ...session,
    presented: [
      ...session.presented,
      {
        pubkey: session.current_demo,
        started_at_ms: session.timer_started_at_ms,
        finished_at_ms: Date.now(),
      },
    ],
    current_demo: null,
    timer_started_at_ms: null,
  };
});
```

Disable already presented demos in the captain’s project picker.

## 14. Timer implementation

Use one pure function for all clients:

```ts
export type TimerState =
  | {
      phase: "presentation";
      remainingMs: number;
    }
  | {
      phase: "questions";
      remainingMs: number;
    }
  | {
      phase: "overtime";
      elapsedMs: number;
    };

export function calculateTimer(
  elapsedMs: number,
): TimerState {
  if (elapsedMs < PRESENTATION_MS) {
    return {
      phase: "presentation",
      remainingMs: PRESENTATION_MS - elapsedMs,
    };
  }

  if (
    elapsedMs <
    PRESENTATION_MS + QUESTIONS_MS
  ) {
    return {
      phase: "questions",
      remainingMs:
        PRESENTATION_MS +
        QUESTIONS_MS -
        elapsedMs,
    };
  }

  return {
    phase: "overtime",
    elapsedMs:
      elapsedMs -
      PRESENTATION_MS -
      QUESTIONS_MS,
  };
}
```

When a start timestamp arrives, anchor it to a monotonic browser clock:

```ts
const initialElapsed =
  Date.now() - timerStartedAtMs;

const monotonicAnchor = performance.now();

function getElapsed(): number {
  return (
    initialElapsed +
    performance.now() -
    monotonicAnchor
  );
}
```

Update the displayed value every 200–250 milliseconds, even though the text changes only once per second. Re-anchor whenever a new session event changes `timer_started_at_ms`.

The front display renders:

```text
PRESENTATION  05:42
QUESTIONS     01:37
OVERTIME     +00:18
```

No relay timer ticks are published.

## 15. Feedback and personal ranking

Keep both inside the participant’s one entry event.

When feedback changes:

```ts
const nextEntry: ParticipantEntry = {
  ...entry,
  feedback: {
    ...entry.feedback,
    [demoOwnerPubkey]: {
      liked,
      learned,
    },
  },
  updated_at_ms: Date.now(),
};
```

When ranking changes:

```ts
const nextEntry: ParticipantEntry = {
  ...entry,
  ranking: orderedCompletedDemoPubkeys,
  updated_at_ms: Date.now(),
};
```

Maintain one local draft and publish the full entry after a short debounce. This prevents drag-and-drop operations from producing several replacements per second.

Once `closed_at_ms` is set, disable feedback and ranking edits in the UI.

## 16. Elo implementation

Implement Elo as a pure function with no React or relay dependencies.

```ts
interface ParsedEntry {
  author: string;
  content: ParticipantEntry;
}

interface EloRow {
  pubkey: string;
  rating: number;
  pairwiseVotes: number;
}

const round6 = (value: number) =>
  Math.round(value * 1_000_000) / 1_000_000;

export function calculateElo(
  presentationOrder: string[],
  entries: ParsedEntry[],
): EloRow[] {
  const ratings = new Map<string, number>();
  const pairwiseVotes = new Map<string, number>();

  for (const demo of presentationOrder) {
    ratings.set(demo, 1500);
    pairwiseVotes.set(demo, 0);
  }

  for (
    let later = 1;
    later < presentationOrder.length;
    later++
  ) {
    for (let earlier = 0; earlier < later; earlier++) {
      const demoA = presentationOrder[earlier];
      const demoB = presentationOrder[later];

      let votesA = 0;
      let votesB = 0;

      for (const entry of entries) {
        // Presenters cannot vote on a pair containing themselves.
        if (
          entry.author === demoA ||
          entry.author === demoB
        ) {
          continue;
        }

        const positionA =
          entry.content.ranking.indexOf(demoA);
        const positionB =
          entry.content.ranking.indexOf(demoB);

        if (positionA < 0 || positionB < 0) {
          continue;
        }

        if (positionA < positionB) votesA++;
        else votesB++;
      }

      const total = votesA + votesB;
      if (total === 0) continue;

      const ratingA = ratings.get(demoA)!;
      const ratingB = ratings.get(demoB)!;

      const expectedA =
        1 /
        (1 +
          Math.pow(
            10,
            (ratingB - ratingA) / 400,
          ));

      const actualA = votesA / total;
      const delta = 32 * (actualA - expectedA);

      ratings.set(demoA, round6(ratingA + delta));
      ratings.set(demoB, round6(ratingB - delta));

      pairwiseVotes.set(
        demoA,
        pairwiseVotes.get(demoA)! + total,
      );

      pairwiseVotes.set(
        demoB,
        pairwiseVotes.get(demoB)! + total,
      );
    }
  }

  return presentationOrder
    .map((pubkey) => ({
      pubkey,
      rating: ratings.get(pubkey)!,
      pairwiseVotes: pairwiseVotes.get(pubkey)!,
    }))
    .sort(
      (a, b) =>
        b.rating - a.rating ||
        a.pubkey.localeCompare(b.pubkey),
    );
}
```

Recalculate from scratch whenever:

- An entry changes
- A demo is completed
- A ranking changes
- The application reconnects
- The session closes

Never update Elo according to event arrival order.

For the final result, assign ranks after sorting:

```ts
const ranked = rows.map((row, index) => ({
  rank: index + 1,
  pubkey: row.pubkey,
  rating: row.rating,
}));
```

## 17. Presenter zaps

The zap recipient is the presenter’s **real pubkey**. The zap target is the address of their ephemeral participant-entry event.

This requires a custom zap-request builder. Do not call an ordinary helper that automatically derives the recipient from the target event’s author, because that would use the ephemeral pubkey.

### Zap flow

1. Load the presenter’s real profile.
2. Parse `lud16` or `lud06`.
3. Fetch the LNURL-pay metadata.
4. Confirm `allowsNostr` and `nostrPubkey`.
5. Ask for an amount and optional message.
6. Create a kind-`9734` request.
7. Send it to the LNURL callback.
8. Receive the Lightning invoice.
9. Open the wallet or display the invoice QR.
10. Watch for the kind-`9735` receipt.

NIP-57 specifies that the `9734` request is sent to the LNURL callback rather than published to relays. The wallet later publishes a `9735` receipt to the relays named in the request. It also permits an `a` tag targeting an addressable event.

### Custom zap request

```ts
export function createPresenterZapRequest({
  entryEvent,
  presenterRealPubkey,
  amountMsat,
  comment,
  secretKey,
}: {
  entryEvent: Event;
  presenterRealPubkey: string;
  amountMsat: number;
  comment: string;
  secretKey: Uint8Array;
}) {
  const d = entryEvent.tags.find(
    (tag) => tag[0] === "d",
  )?.[1];

  if (!d) {
    throw new Error("Entry event has no d tag");
  }

  const entryAddress =
    `30078:${entryEvent.pubkey}:${d}`;

  return finalizeEvent(
    {
      kind: 9734,
      created_at: Math.floor(Date.now() / 1000),
      content: comment,
      tags: [
        ["relays", ...DEFAULT_RELAYS],
        ["amount", String(amountMsat)],
        ["p", presenterRealPubkey],
        ["a", entryAddress],
        ["k", "30078"],
      ],
    },
    secretKey,
  );
}
```

The important relationship is:

```text
p = presenter’s real pubkey
a = presenter’s ephemeral demo-entry address
```

### Payment interface

After receiving the invoice:

- On mobile, open `lightning:<invoice>`.
- On desktop, show a QR code.
- Offer a copy-invoice button.
- Optionally use WebLN when available, but do not require it.

### Receipt subscription

```ts
pool.subscribe(
  [...DEFAULT_RELAYS],
  {
    kinds: [9735],
    "#a": [entryAddress],
    "#p": [presenterRealPubkey],
  },
  {
    onevent: ingestZapReceipt,
  },
);
```

For this internal application, validate at least:

- Receipt signature
- Embedded zap-request signature
- Expected `p`
- Expected `a`
- Expected `k`
- Receipt author equals the LNURL metadata’s `nostrPubkey`
- Invoice amount matches the requested amount
- Duplicate receipt IDs are ignored

The presenter-real-key special case and complete receipt checks should live in `zaps.ts`.

## 18. Closing the demo day

When the captain presses **Close demo day**:

1. Query all latest entry events for the session.
2. Query their copied kind-`0` profiles.
3. Query current zap receipts for every demo entry.
4. Resolve replacement conflicts.
5. Compute final Elo.
6. Create the final session replacement.
7. Disable all edit controls.

A practical close function:

```ts
async function closeDemoDay(): Promise<void> {
  const entries = await repository.refreshSessionEntries({
    maxWait: 4_000,
  });

  const zaps = await repository.refreshSessionZaps({
    maxWait: 4_000,
  });

  const presented = currentSession.presented.map(
    (run) => run.pubkey,
  );

  const finalElo = calculateElo(
    presented,
    entries,
  ).map((row, index) => ({
    rank: index + 1,
    pubkey: row.pubkey,
    rating: row.rating,
  }));

  await mutateSession((session) => ({
    ...session,
    current_demo: null,
    timer_started_at_ms: null,
    closed_at_ms: Date.now(),
    final_elo: finalElo,
    snapshot_entry_ids: entries.map(
      (entry) => entry.event.id,
    ),
    snapshot_zap_ids: zaps.map(
      (zap) => zap.id,
    ),
  }));
}
```

All other clients detect `closed_at_ms !== null` and switch to the summary view.

Because participant entries have session-specific `d` values, closing one demo day does not interfere with the same participant’s entry in another demo day.

## 19. JSON export

Create the export entirely in the browser.

```ts
export function downloadJson(
  filename: string,
  value: unknown,
): void {
  const blob = new Blob(
    [JSON.stringify(value, null, 2)],
    {
      type: "application/json;charset=utf-8",
    },
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}
```

Build the export from:

- Closed session event
- Snapshotted participant entries
- Copied profiles
- Real pubkeys
- Presentation timings
- Feedback
- Personal rankings
- Pairwise Elo calculations
- Valid zap receipts
- Raw signed source events

Explicitly omit:

```text
nsec
secret-key bytes
localStorage contents
locally added relay history unrelated to the session
```

The export generation should be a pure function:

```ts
buildExport({
  sessionEvent,
  entries,
  profiles,
  zapReceipts,
});
```

This makes it straightforward to unit-test the JSON schema.

## 20. Follow suggestions

After closure, determine the viewer’s real pubkey from their participant entry.

Query their latest kind-`3` event across:

```ts
[
  ...DEFAULT_RELAYS,
  ...identity.addedProfileRelays,
]
```

NIP-02 defines kind `3` as a replaceable follow list containing one `p` tag per followed public key.

```ts
export function calculateFollowSuggestions({
  ownRealPubkey,
  participantRealPubkeys,
  followEvent,
}: {
  ownRealPubkey: string;
  participantRealPubkeys: string[];
  followEvent: Event;
}): string[] {
  const followed = new Set(
    followEvent.tags
      .filter(
        (tag) =>
          tag[0] === "p" &&
          /^[0-9a-f]{64}$/.test(tag[1] ?? ""),
      )
      .map((tag) => tag[1]),
  );

  return [
    ...new Set(participantRealPubkeys),
  ].filter(
    (pubkey) =>
      pubkey !== ownRealPubkey &&
      !followed.has(pubkey),
  );
}
```

If no follow list is found, ask for another relay just as the profile flow does.

Each suggestion should use the real account:

```text
[Avatar] Alice

Open in Nostr
Copy npub
```

Generate the link as:

```ts
const href = `nostr:${npubEncode(realPubkey)}`;
```

Do not attempt to publish a kind-`3` event because the app does not possess the user’s real private key.

## 21. React application state

Use one provider and reducer rather than multiple global state libraries.

```ts
interface AppState {
  sessions: Map<string, Event>;
  entries: Map<string, Event>;
  profiles: Map<string, Event>;
  follows: Map<string, Event>;
  zaps: Map<string, Event>;

  selectedSessionAddress: string | null;
  connectedRelays: Set<string>;
}
```

Reducer actions:

```text
EVENT_RECEIVED
EVENT_PUBLISHED
SESSION_SELECTED
RELAY_CONNECTED
RELAY_DISCONNECTED
IDENTITY_CHANGED
RESET
```

All rendered state should be derived from signed events.

For optimistic updates:

1. Sign the event.
2. Ingest it into the local event index immediately.
3. Render the new state.
4. Publish it.
5. Show a small warning if every relay rejects it.
6. Retain the signed event in a local retry queue.

A simple local retry record:

```ts
interface PendingPublish {
  event: Event;
  addedAtMs: number;
}
```

Store pending publishes in `localStorage`, retry them on startup and when the browser’s `online` event fires, and remove them after any relay accepts them.

## 22. Testing strategy

### Pure unit tests

Write tests for:

| Module | Required tests |
|---|---|
| Event index | Newer event wins; equal timestamps use lower ID |
| Profile import | Content and tags copied exactly |
| Timer | `06:00`, `00:00`, questions, and overtime boundaries |
| Elo | Deterministic pair order, missing rankings, presenter exclusion |
| Follow suggestions | Excludes self, duplicates, and already-followed keys |
| Zap builder | Real key in `p`, ephemeral entry coordinate in `a` |
| Export | Contains required data and never contains `nsec` |

### Integration tests

Create a `NostrTransport` interface:

```ts
interface NostrTransport {
  query(
    relays: string[],
    filter: Filter,
  ): Promise<Event[]>;

  subscribe(
    relays: string[],
    filter: Filter,
    onEvent: (event: Event) => void,
  ): () => void;

  publish(
    relays: string[],
    event: Event,
  ): Promise<void>;
}
```

Provide:

```text
SimplePoolTransport
InMemoryTestTransport
```

The in-memory transport lets tests simulate two participants and a display computer without touching public relays.

Test these complete flows:

1. Captain creates a session; another client discovers it.
2. Participant imports a profile and joins.
3. Participant count updates.
4. Captain presses GO; every client shows the selected demo.
5. Captain starts the timer; the display crosses presentation, questions, and overtime.
6. Participant submits feedback and ranking.
7. Live Elo updates identically on two clients.
8. Zap request targets the real presenter key.
9. Captain closes the session.
10. JSON export reproduces final Elo and feedback.
11. Follow suggestions omit already-followed real accounts.

Use Playwright for the front-display and multi-tab flows.

## 23. Deployment

Build:

```bash
npm run build
```

The resulting `dist/` directory can be served by any static HTTPS host.

Use a domain such as:

```text
demoday.sovereignengineering.io
```

Configure:

```text
Cache index.html briefly
Cache hashed JavaScript/CSS assets for a long period
Allow WebSocket connections to the relay list
Allow HTTP requests to LNURL endpoints
```

No server-side session, cookie, database, or secret is required.

The main operational test before an actual demo day should verify:

- At least several hardcoded relays accept kind `30078`
- Real participant profiles can be found
- Presenter Lightning addresses support NIP-57
- LNURL endpoints permit browser requests
- The front display’s device clock is reasonably synchronized

## 24. Build order

Implement in this order:

1. **Nostr foundation:** identity, pool, event index, parsing, and publishing.
2. **Discovery:** active-session subscription, captain profiles, participant counts.
3. **Profile import:** real `npub`, fallback relay input, exact kind-`0` copying.
4. **Participation:** demo form and participant entry replacement.
5. **Captain controls:** create session, GO, START, RESTART, DONE.
6. **Front display:** current demo, presentation, questions, overtime.
7. **Feedback and ranking:** single participant-entry updates.
8. **Elo:** deterministic live leaderboard.
9. **Zaps:** real presenter recipient and ephemeral demo target.
10. **Closure:** final session update and read-only summary.
11. **JSON export:** normalized and raw source data.
12. **Follow suggestions:** real-account kind-`3` comparison.
13. **Integration tests and static deployment.**

The most important architectural rule is to keep all relay and protocol behavior in the Nostr repository. React pages should never construct filters, resolve replaceable events, or sign events themselves. That separation keeps the application small while making the timer, Elo, zap, and closing behavior independently testable.

## References

- [Nostr Tools](https://github.com/nbd-wtf/nostr-tools)
- [NIP-01: Basic protocol flow](https://github.com/nostr-protocol/nips/blob/master/01.md)
- [NIP-02: Follow list](https://github.com/nostr-protocol/nips/blob/master/02.md)
- [NIP-19: Bech32-encoded entities](https://github.com/nostr-protocol/nips/blob/master/19.md)
- [NIP-57: Lightning zaps](https://github.com/nostr-protocol/nips/blob/master/57.md)
- [NIP-78: Application data](https://github.com/nostr-protocol/nips/blob/master/78.md)
