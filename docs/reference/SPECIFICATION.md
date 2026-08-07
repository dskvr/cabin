# Sovereign Engineering Demo Day Tracker

## Simple Nostr Application Specification

**Specification version:** 1.0  
**Application event kind:** `30078`  
**Profile event kind:** `0`  
**Follow-list event kind:** `3` (read only)  
**Zap event kinds:** `9734` and `9735`

---

## 1. Purpose

The Sovereign Engineering Demo Day Tracker is a small, internal Nostr application for running demo days.

It must:

- Show currently active demo days when the app opens.
- Show who started each demo day and how many participants have joined.
- Let a participant join by clicking a demo day.
- Generate and locally retain an ephemeral Nostr keypair for each browser.
- Import a participant's complete profile from their normal Nostr account and republish it under the ephemeral pubkey.
- Let each participant publish and update one demo description.
- Let the captain choose the current demo, announce it with **GO!**, and start its timer.
- Show the current project, its description, and a zap button on every participant client.
- Show six minutes of presentation time, two minutes of questions, and then overtime counting upward.
- Let participants provide feedback and rank demos.
- Calculate and display live Elo rankings.
- Zap the presenter's normal Nostr account.
- Close the demo day and show a final summary.
- Export the complete closed session as downloadable JSON suitable for AI models.
- Suggest that each participant follow the other participants' normal Nostr accounts, excluding accounts they already follow.

The application has no backend and no relay settings screen. It uses a fixed relay pool.

---

## 2. Design principles

The implementation should stay deliberately small.

- There is no roster lock.
- There is no registration period.
- There is no schedule event.
- There is no separate timer event.
- There is no timer heartbeat.
- There is no lifecycle log.
- There is no distinction between `open` and `live`.
- There is no co-presenter model.
- There is no relay configuration screen.
- There are only two application-specific record shapes, both using kind `30078`:
  1. One captain-owned session record.
  2. One participant-owned entry record per participant per session.

A demo day is either:

```text
active
closed
```

Within an active session, the current state is derived from the session fields:

| Session state | Meaning |
|---|---|
| `current_demo_pubkey == null` | Between demonstrations |
| Current demo set and `timer_started_at_ms == null` | Demo selected and ready |
| Current demo set and timer start set | Timer running |
| `closed_at_ms != null` | Demo day closed |

---

## 3. Hardcoded constants

```typescript
export const APP_KIND = 30078;
export const PROFILE_KIND = 0;
export const FOLLOW_LIST_KIND = 3;
export const ZAP_REQUEST_KIND = 9734;
export const ZAP_RECEIPT_KIND = 9735;

export const PRESENTATION_MS = 6 * 60 * 1000;
export const QUESTIONS_MS = 2 * 60 * 1000;

export const ELO_INITIAL = 1500;
export const ELO_K = 32;
export const ELO_SCALE = 400;
```

### 3.1 Hardcoded relay pool

The application uses the following ten relays for all demo-day discovery, reading, and publishing:

```typescript
export const DEFAULT_RELAYS = Object.freeze([
  "wss://relay.nostr.com",
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.snort.social",
  "wss://nostr.bitcoiner.social",
  "wss://nostr.mom",
  "wss://relay.nostr.band",
  "wss://offchain.pub",
  "wss://purplepag.es"
] as const);
```

There is no user-facing relay configuration screen.

The only time a user enters a relay is when the app cannot find that user's normal Nostr profile or follow list. Such relays are stored as account-specific lookup relays and are not added to the shared demo-day relay pool.

---

## 4. Identity model

Each participant has two public keys.

| Identity | Purpose |
|---|---|
| Ephemeral pubkey | Signs all demo-day events and the copied kind-`0` profile |
| Real pubkey | Identifies the participant's normal Nostr account, receives zaps, and is used for follow suggestions |

The app never asks for or uses the real account's private key.

The real account is associated with the ephemeral account by the participant entering its `npub`. This association is not cryptographically verified.

### 4.1 Ephemeral identity creation

The first time the browser needs to join or create a demo day, it:

1. Generates a secp256k1 secret key.
2. Derives the public key.
3. Encodes them as `nsec` and `npub` for display.
4. Stores them unencrypted in `localStorage`.

Suggested storage key:

```text
sedd.identity.v1
```

Suggested local record:

```json
{
  "version": 1,
  "secret_key_hex": "<64-character-hex>",
  "public_key_hex": "<64-character-hex>",
  "nsec": "nsec1...",
  "npub": "npub1...",

  "real_pubkey_hex": "<64-character-hex>",
  "real_npub": "npub1...",

  "source_profile_event_id": "<kind-0-event-id>",
  "source_profile_relay": "wss://relay.example",
  "real_account_relays": [
    "wss://relay.example"
  ],

  "copied_profile_event_id": "<ephemeral-kind-0-event-id>",
  "created_at_ms": 1786032000123,
  "profile_refreshed_at_ms": 1786032100456
}
```

The same ephemeral identity is reused until the user clears local storage or explicitly resets the identity.

---

## 5. Importing the participant's normal Nostr profile

The participant is not asked for a name, picture, bio, website, Lightning address, or any other profile field.

The app asks for exactly one profile-related value:

```text
Your usual Nostr npub

[ npub1........................................ ]

[ Import profile ]
```

### 5.1 Default lookup

The app:

1. Validates and decodes the supplied `npub` to a hex pubkey.
2. Queries all ten default relays for the latest kind-`0` event authored by that pubkey.
3. Verifies returned event signatures.
4. Resolves the newest valid profile across all relay results.
5. Shows a profile preview.
6. Republishes the complete profile under the generated ephemeral pubkey.

Filter sent to each relay:

```json
{
  "kinds": [0],
  "authors": ["<real-pubkey-hex>"],
  "limit": 1
}
```

For replaceable-event resolution:

1. Prefer the event with the greatest `created_at`.
2. If timestamps are equal, prefer the lexicographically lower event ID.

### 5.2 Profile not found

If no profile is found on the default relays, the app does not tell the participant to republish their profile.

It shows:

```text
Profile not found on the default relays

Paste a relay where your usual Nostr profile can be found.

[ wss://relay.example.com                         ]

[ Search relay ]
```

When **Search relay** is pressed, the app:

1. Requires a valid `wss://` relay URL.
2. Connects to the relay.
3. Requests the latest kind-`0` event for the real pubkey.
4. Verifies the event signature.
5. Uses the profile if found.
6. Saves the successful relay in `real_account_relays`.

If the profile is still not found:

```text
No profile was found on this relay.

Check the relay address or add another relay.

[ Add another relay ]
```

There is no manual profile-entry fallback.

### 5.3 Copying the entire profile

The complete source profile is republished under the ephemeral pubkey.

The app preserves:

- The exact `content` string.
- All source tags.
- Known fields.
- Unknown or custom fields.
- Fields such as `name`, `display_name`, `about`, `picture`, `banner`, `website`, `nip05`, `lud06`, `lud16`, and any extensions.

Only fields that necessarily belong to the new event are changed:

- `id`
- `pubkey`
- `created_at`
- `sig`

Conceptually:

```typescript
const copiedProfileTemplate = {
  kind: 0,
  created_at: nextCreatedAt(previousCopiedProfile),
  tags: sourceProfile.tags.map((tag) => [...tag]),
  content: sourceProfile.content
};
```

The copied profile is signed by the ephemeral key and published to all ten default relays.

A copied `nip05` field is retained but must not be presented as verified for the ephemeral pubkey, because it normally resolves to the real pubkey.

### 5.4 Profile refresh

The identity panel may offer:

```text
Real account: npub1...
Imported profile: Alice
Source relay: wss://relay.example

[ Refresh imported profile ]
[ Copy real npub ]
[ Copy ephemeral npub ]
[ Reset local identity ]
```

Refreshing repeats the profile lookup against:

```typescript
const accountLookupRelays = dedupe([
  ...DEFAULT_RELAYS,
  ...identity.real_account_relays
]);
```

If a newer real profile is found, the app republishes its complete contents under the same ephemeral pubkey.

---

## 6. Application event model

The app uses the following Nostr kinds:

| Kind | Use | Published by this app? |
|---:|---|---|
| `0` | Complete copied profile under the ephemeral pubkey | Yes |
| `3` | Real account's current follow list | No, read only |
| `30078` | Captain-owned session record | Yes |
| `30078` | Participant-owned entry record | Yes |
| `9734` | Zap request | Yes, through the zap flow |
| `9735` | Zap receipt | No, produced by the recipient's Lightning service |

There are no other application-specific event shapes.

---

## 7. Demo-day discovery

Opening the app is read-only. The client immediately subscribes to active session records on all ten default relays.

```json
[
  "REQ",
  "active-demo-days",
  {
    "kinds": [30078],
    "#t": ["sedd-session"],
    "limit": 200
  }
]
```

The client deduplicates events by ID and resolves the latest event for each addressable coordinate.

A session is active when:

```json
"closed_at_ms": null
```

For each active session, the app fetches:

- The captain's latest copied kind-`0` profile.
- All latest participant entries tagged with the session address.
- The entry for the currently selected demo, if any.

Each home-screen card displays:

```text
Demo-day name
Captain profile picture
Captain name
Participant count
Current project, or “Between demos”

[ Join ]    [ Display ]
```

The captain name is selected in this order:

1. `display_name`
2. `name`
3. A shortened ephemeral `npub`

The participant count is the number of unique latest valid participant-entry coordinates for that session.

There is no roster event.

---

## 8. Selecting a demo day authorizes the captain

The author of the selected session event is the captain.

When a participant or display computer clicks a session, the client stores:

```typescript
selectedSession = {
  address: "30078:<captain-pubkey>:<session-d>",
  captainPubkey: "<captain-pubkey>",
  d: "<session-d>"
};
```

After selection, the client accepts session-state replacements only when all of the following match:

```text
kind = 30078
pubkey = selected captain pubkey
d = selected session d
```

The user's click is the authorization action. There is no separate captain registry, permission event, or role assignment.

Anyone can publish a session, but users explicitly choose which session author to trust as captain.

---

## 9. Creating a demo day

The home screen has:

```text
[ Start a demo day ]
```

The captain first completes the same normal-account profile import used by all other participants.

They then enter:

```text
Demo-day name

Your demo name
Your demo description
Your demo link — optional
```

Creating the demo day publishes:

1. The captain's copied kind-`0` profile, if it is not already available.
2. One captain-owned session event.
3. One ordinary participant-entry event for the captain.

The captain is therefore also a normal participant. Their only additional capability is that their ephemeral pubkey authors the session event.

### 9.1 Session identifier

```text
session_d = sedd-session:<128-bit-random-lowercase-hex>
```

Example:

```text
sedd-session:079ef557d98f4a4695b604eb18fa02ca
```

Session address:

```text
30078:<captain-ephemeral-pubkey>:<session-d>
```

---

## 10. Session event

### 10.1 Tags

```json
[
  ["d", "sedd-session:079ef557d98f4a4695b604eb18fa02ca"],
  ["t", "sedd-session"]
]
```

### 10.2 Content schema

```typescript
interface DemoDaySessionV1 {
  v: 1;
  type: "session";

  name: string;
  created_at_ms: number;
  closed_at_ms: number | null;

  current_demo_pubkey: string | null;
  timer_started_at_ms: number | null;

  presented: Array<{
    pubkey: string;
    started_at_ms: number;
    finished_at_ms: number;
  }>;

  final_elo: Array<{
    rank: number;
    pubkey: string;
    rating: number;
  }> | null;

  snapshot_entry_ids: string[] | null;
  snapshot_profile_ids: string[] | null;
  snapshot_zap_ids: string[] | null;
}
```

### 10.3 Initial event example

```json
{
  "kind": 30078,
  "pubkey": "<captain-ephemeral-pubkey>",
  "created_at": 1786032000,
  "tags": [
    ["d", "sedd-session:079ef557d98f4a4695b604eb18fa02ca"],
    ["t", "sedd-session"]
  ],
  "content": "{\"v\":1,\"type\":\"session\",\"name\":\"SEC-08 — Week 3 Demo Day\",\"created_at_ms\":1786032000123,\"closed_at_ms\":null,\"current_demo_pubkey\":null,\"timer_started_at_ms\":null,\"presented\":[],\"final_elo\":null,\"snapshot_entry_ids\":null,\"snapshot_profile_ids\":null,\"snapshot_zap_ids\":null}"
}
```

Only the captain's ephemeral pubkey updates this addressable session record.

---

## 11. Joining a demo day

Clicking **Join**:

1. Selects the session and trusts its author as captain.
2. Creates or loads the browser's ephemeral identity.
3. Imports the participant's normal Nostr profile if not already imported.
4. Opens the demo form.

After profile import, the form asks only for:

```text
Demo name

Demo description

Demo link — optional

[ Join demo day ]
```

Submitting publishes one participant-entry event.

There is no separate join event.

---

## 12. Participant-entry event

Every participant publishes exactly one addressable entry per session.

The entry contains:

- The link to their real Nostr account.
- The source profile reference.
- Their demo information.
- Their current personal ranking.
- All feedback they have written in the session.

### 12.1 Address

```text
kind = 30078
author = participant ephemeral pubkey
d = sedd-entry:<session-d>
```

Example:

```text
sedd-entry:sedd-session:079ef557d98f4a4695b604eb18fa02ca
```

The author pubkey is part of the addressable-event coordinate, so every participant can use the same session-specific `d` value without collision.

### 12.2 Content schema

```typescript
interface ParticipantEntryV1 {
  v: 1;
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

  feedback: Record<
    string,
    {
      liked: string;
      learned: string;
    }
  >;

  updated_at_ms: number;
}
```

The strings in `ranking` and the keys in `feedback` are ephemeral participant pubkeys. There is exactly one demo per participant, so the ephemeral participant pubkey is the demo identifier inside a session.

### 12.3 Tags

When the presenter's imported normal profile contains a Lightning address, the entry includes a zap redirect to the presenter's real pubkey:

```json
[
  ["d", "sedd-entry:<session-d>"],
  ["t", "sedd-entry"],
  ["a", "30078:<captain-pubkey>:<session-d>"],
  ["p", "<presenter-real-pubkey>", "<source-profile-relay>", "presenter"],
  ["zap", "<presenter-real-pubkey>", "<source-profile-relay>", "1"]
]
```

When the profile contains neither `lud16` nor `lud06`, the `zap` tag is omitted.

### 12.4 Full event example

```json
{
  "kind": 30078,
  "pubkey": "<participant-ephemeral-pubkey>",
  "created_at": 1786032200,
  "tags": [
    ["d", "sedd-entry:sedd-session:079ef557d98f4a4695b604eb18fa02ca"],
    ["t", "sedd-entry"],
    ["a", "30078:<captain-pubkey>:sedd-session:079ef557d98f4a4695b604eb18fa02ca"],
    ["p", "<participant-real-pubkey>", "wss://relay.example", "presenter"],
    ["zap", "<participant-real-pubkey>", "wss://relay.example", "1"]
  ],
  "content": "{\"v\":1,\"type\":\"entry\",\"real_pubkey\":\"<participant-real-pubkey>\",\"source_profile_event_id\":\"<source-kind-0-id>\",\"source_profile_relay\":\"wss://relay.example\",\"demo\":{\"name\":\"Nostr-powered sensor network\",\"description\":\"A local-first environmental sensor system that publishes signed readings over Nostr.\",\"link\":\"https://example.com/project\"},\"ranking\":[],\"feedback\":{},\"updated_at_ms\":1786032200123}"
}
```

### 12.5 Updating an entry

Changing any of the following republishes the same addressable entry:

- Demo name.
- Demo description.
- Demo link.
- Ranking order.
- Feedback.
- Profile-source metadata after a refresh.

The complete current entry is always published. An update must preserve all fields not being edited.

To avoid ambiguous same-second replacements:

```typescript
function nextCreatedAt(previousCreatedAt?: number): number {
  const now = Math.floor(Date.now() / 1000);
  return previousCreatedAt == null
    ? now
    : Math.max(now, previousCreatedAt + 1);
}
```

Participants may update their demo at any time before the session is closed.

---

## 13. Captain controls

The captain client shows all latest participant entries for the selected session.

Presented projects are disabled. Unpresented projects remain available in an unordered list.

There is no schedule object.

Controls:

```text
[ Select project ▼ ]

[ GO! ]

[ START TIMER ]

[ RESTART ]

[ DONE ]

[ CLOSE DEMO DAY ]
```

Captain controls are shown only when:

```typescript
localEphemeralPubkey === selectedSession.captainPubkey
```

### 13.1 GO!

The captain selects a participant and presses **GO!**.

The session event is replaced with:

```json
{
  "current_demo_pubkey": "<participant-ephemeral-pubkey>",
  "timer_started_at_ms": null
}
```

All connected clients immediately show:

- Demo name.
- Demo description.
- Optional link.
- Presenter profile.
- Presenter zap button, when available.
- `READY` state.

### 13.2 START TIMER

When the presenter is ready, the captain presses **START TIMER**.

The session event is replaced with:

```json
{
  "current_demo_pubkey": "<participant-ephemeral-pubkey>",
  "timer_started_at_ms": 1786032600123
}
```

No timer event or heartbeat is published. All clients calculate the timer locally.

### 13.3 RESTART

**RESTART** replaces `timer_started_at_ms` with the current `Date.now()` value.

The timer returns to six minutes.

There is no pause function.

### 13.4 DONE

When the demo is finished, the captain presses **DONE**.

The current run is appended to `presented`:

```json
{
  "pubkey": "<participant-ephemeral-pubkey>",
  "started_at_ms": 1786032600123,
  "finished_at_ms": 1786033098456
}
```

The session then sets:

```json
{
  "current_demo_pubkey": null,
  "timer_started_at_ms": null
}
```

The completed demo becomes available for feedback and ranking.

---

## 14. Timer behavior

Every client derives elapsed time from the captain's timestamp:

```typescript
const elapsedMs = Date.now() - session.timer_started_at_ms;
```

Normal device clock synchronization is assumed.

### 14.1 Presentation phase

When:

```text
elapsedMs < 360,000
```

Display:

```text
PRESENTATION
05:42
```

```typescript
const remainingSeconds = Math.ceil(
  (PRESENTATION_MS - elapsedMs) / 1000
);
```

### 14.2 Questions phase

When:

```text
360,000 <= elapsedMs < 480,000
```

Display:

```text
QUESTIONS
01:37
```

```typescript
const remainingSeconds = Math.ceil(
  (PRESENTATION_MS + QUESTIONS_MS - elapsedMs) / 1000
);
```

### 14.3 Overtime phase

When:

```text
elapsedMs >= 480,000
```

Display:

```text
OVERTIME
+00:18
```

```typescript
const overtimeSeconds = Math.floor(
  (elapsedMs - PRESENTATION_MS - QUESTIONS_MS) / 1000
);
```

Countdowns use `MM:SS`. Overtime uses `+MM:SS`, or `+HH:MM:SS` when necessary.

---

## 15. Participant client during a demo

When **GO!** has been pressed but the timer has not started:

```text
Nostr-powered sensor network

A local-first environmental sensor system that publishes
signed readings over Nostr.

Presented by Alice

READY

[ Open project ]   [ ⚡ Zap Alice ]
```

When the timer is running:

```text
Nostr-powered sensor network

PRESENTATION — 05:42

[ Open project ]   [ ⚡ Zap Alice ]
```

The project information always comes from the latest participant-entry event for `current_demo_pubkey`.

If the presenter updates their demo description while selected, connected clients update automatically.

---

## 16. Front-of-room display

The display computer opens the same app and sees the same active demo-day list.

It selects **Display** on the desired session. That selection trusts the session author as captain in the same way as a participant click.

Display mode is read-only and does not publish a participant entry.

### 16.1 Ready state

```text
NOSTR-POWERED SENSOR NETWORK

A local-first environmental sensor system
that publishes signed readings over Nostr.

READY
```

### 16.2 Presentation state

```text
NOSTR-POWERED SENSOR NETWORK

PRESENTATION

05:42
```

### 16.3 Questions state

```text
NOSTR-POWERED SENSOR NETWORK

QUESTIONS

01:37
```

### 16.4 Overtime state

```text
NOSTR-POWERED SENSOR NETWORK

OVERTIME

+00:18
```

### 16.5 Between demos

```text
SEC-08 — Week 3 Demo Day

Waiting for the next demonstration
```

The project name and timer are the largest elements. The description is smaller and may be limited to two or three lines.

The front display does not need a zap control. Participant devices do.

---

## 17. Feedback

After a demo is marked **DONE**, every participant may fill in:

```text
What did you like about this demo?

What did you learn from this demo?
```

Feedback is stored inside the author's participant entry:

```json
{
  "feedback": {
    "<demo-owner-ephemeral-pubkey>": {
      "liked": "The relay-failure demonstration made the design easy to understand.",
      "learned": "I learned how addressable events can act as mutable project records."
    }
  }
}
```

Recommended maximum length:

```text
280 characters per field
```

Updating feedback republishes the participant's single entry event.

A project page gathers feedback by reading:

```typescript
entry.feedback[demoOwnerEphemeralPubkey]
```

The UI groups responses under:

```text
What people liked
What people learned
```

---

## 18. Personal ranking

Every participant maintains one ordered list of completed demos.

The UI is a drag-and-drop list:

```text
1. Project Gamma
2. Project Alpha
3. Project Delta
4. Project Beta
```

When a new demo is marked **DONE**, it appears under:

```text
Not yet ranked
```

The participant drags it into their ranking.

The ordering is stored in the participant entry:

```json
{
  "ranking": [
    "<project-gamma-owner-ephemeral-pubkey>",
    "<project-alpha-owner-ephemeral-pubkey>",
    "<project-delta-owner-ephemeral-pubkey>",
    "<project-beta-owner-ephemeral-pubkey>"
  ]
}
```

Rules:

- Only completed demos are valid.
- The participant's own demo is ignored.
- A ranking may be incomplete.
- A project absent from a participant's list contributes no preference from that participant.
- Participants may revise the list until the captain closes the session.

---

## 19. Live Elo ranking

The app converts each participant's ordered list into pairwise preferences.

For:

```text
A > C > B
```

The participant contributes:

```text
A beats C
A beats B
C beats B
```

### 19.1 Aggregate pair result

For each pair of completed demos, count rankings that contain both projects.

Example:

```text
8 participants rank A above B
3 participants rank B above A
```

The pair's actual score is:

```typescript
const actualA = 8 / 11;
const actualB = 3 / 11;
```

A tied aggregate vote produces `0.5` for each project.

A pair with no valid comparisons is skipped.

### 19.2 Presenter exclusion

For a pair between projects A and B:

- A's presenter does not vote on that pair.
- B's presenter does not vote on that pair.

The calculation enforces this even if a malformed ranking includes the participant's own demo.

### 19.3 Deterministic pair order

Elo is order-dependent, so all clients use presentation order.

For completed demos:

```text
A, B, C, D
```

pairs are processed as:

```text
A-B
A-C
B-C
A-D
B-D
C-D
```

Reference loop:

```typescript
for (let later = 1; later < presented.length; later++) {
  for (let earlier = 0; earlier < later; earlier++) {
    processPair(presented[earlier], presented[later]);
  }
}
```

### 19.4 Elo formula

Every demo starts at `1500`.

```typescript
const expectedA =
  1 / (1 + Math.pow(10, (ratingB - ratingA) / ELO_SCALE));

const actualA =
  votesForA / (votesForA + votesForB);

const delta =
  ELO_K * (actualA - expectedA);

ratingA += delta;
ratingB -= delta;
```

Ratings are recalculated from the complete current dataset whenever any participant entry changes. Relay arrival order is never used as match order.

The live leaderboard updates when:

- A demo is marked done.
- A participant changes their ranking.
- A participant entry is received or replaced.

The UI displays rounded ratings, while the final export retains six decimal places.

Example:

```text
1. Project Gamma    1587
2. Project Alpha    1542
3. Project Delta    1491
4. Project Beta     1380
```

The leaderboard includes:

```text
Rank
Project
Presenter
Elo
Pairwise vote count
Zap count
Sats received
```

Zaps never affect Elo.

---

## 20. Presenter zaps

Every demo zap goes to the presenter's real Nostr account, not to the ephemeral demo-day account.

The presenter's real pubkey is taken from:

```json
"real_pubkey": "<presenter-real-pubkey>"
```

The Lightning address is taken from the complete imported profile's `lud16` or `lud06` field.

### 20.1 Zap availability

If neither `lud16` nor `lud06` is present:

```text
Zap unavailable

This presenter has not added a Lightning address to their Nostr profile.
```

If the LNURL endpoint does not advertise Nostr-zap support:

```text
Zap unavailable

This presenter's Lightning address does not support Nostr zaps.
```

The app does not ask the presenter to enter a separate Lightning address.

### 20.2 Zap request target

A zap request uses:

```text
p = presenter's real pubkey
a = presenter's participant-entry address
k = 30078
```

Example:

```json
{
  "kind": 9734,
  "pubkey": "<zapper-ephemeral-pubkey>",
  "created_at": 1786038300,
  "content": "<optional-comment>",
  "tags": [
    [
      "relays",
      "wss://relay.nostr.com",
      "wss://relay.damus.io",
      "wss://nos.lol",
      "wss://relay.primal.net",
      "wss://relay.snort.social",
      "wss://nostr.bitcoiner.social",
      "wss://nostr.mom",
      "wss://relay.nostr.band",
      "wss://offchain.pub",
      "wss://purplepag.es"
    ],
    ["amount", "21000000"],
    ["lnurl", "<presenter-lnurl>"],
    ["p", "<presenter-real-pubkey>"],
    ["a", "30078:<presenter-ephemeral-pubkey>:sedd-entry:<session-d>"],
    ["k", "30078"]
  ]
}
```

This pays the presenter while preserving attribution to the specific demo entry.

### 20.3 Payment UX

The zap flow may:

1. Request the LNURL-pay invoice.
2. Pay through WebLN when available.
3. Otherwise show the invoice as a QR code and copyable payment request.

### 20.4 Receipt counting

A receipt counts for a demo when its embedded request contains:

```text
p = demo owner's real pubkey
a = demo owner's participant-entry coordinate
k = 30078
```

The app should also:

- Verify the receipt event signature.
- Verify the embedded zap-request signature.
- Deduplicate by receipt event ID.
- Confirm the invoice amount when possible.

Every demo displays:

```text
Zap count
Total sats
Zap comments
```

The session displays:

```text
Total zaps to presenters
Total sats sent to presenters
```

---

## 21. Relay behavior

### 21.1 Demo-day data

All demo-day subscriptions and publications use the ten default relays.

This includes:

- Active session discovery.
- Session replacements.
- Participant entries.
- Copied ephemeral profiles.
- Zap receipt subscriptions.

The client:

- Connects to all ten relays.
- Deduplicates events by ID.
- Resolves replaceable events over the combined result set.
- Treats an operation as published after the first successful relay acknowledgement.
- Continues best-effort publication to the remaining relays.
- Reconnects automatically.
- Ignores individual relay failures.

### 21.2 Account-specific lookup relays

A relay entered because a real profile or follow list was not found is used only for that real account.

```typescript
const realAccountLookupRelays = dedupe([
  ...DEFAULT_RELAYS,
  ...identity.real_account_relays
]);
```

These additional relays are used for:

- Looking up the user's real kind-`0` profile.
- Refreshing that profile.
- Looking up the user's real kind-`3` follow list.
- Looking up fresher presenter payment metadata when necessary.

They are not used for shared demo-day discovery or publishing.

---

## 22. Closing the demo day

The captain presses:

```text
[ CLOSE DEMO DAY ]
```

The client then:

1. Fetches the latest participant-entry event for every participant.
2. Fetches the corresponding latest copied kind-`0` profiles.
3. Fetches zap receipts for the participant-entry coordinates.
4. Computes the final Elo leaderboard.
5. Publishes one final replacement of the session event.

There is no separate close event, manifest, result event, or lifecycle record.

### 22.1 Final session content

The closed session sets:

```json
{
  "closed_at_ms": 1786043000123,
  "current_demo_pubkey": null,
  "timer_started_at_ms": null,
  "final_elo": [
    {
      "rank": 1,
      "pubkey": "<participant-b-ephemeral-pubkey>",
      "rating": 1587.342811
    },
    {
      "rank": 2,
      "pubkey": "<participant-a-ephemeral-pubkey>",
      "rating": 1542.119084
    }
  ],
  "snapshot_entry_ids": [
    "<entry-event-id-a>",
    "<entry-event-id-b>"
  ],
  "snapshot_profile_ids": [
    "<copied-kind-0-id-a>",
    "<copied-kind-0-id-b>"
  ],
  "snapshot_zap_ids": [
    "<zap-receipt-id-1>",
    "<zap-receipt-id-2>"
  ]
}
```

All connected clients receive the replacement and switch to the closed summary.

The home screen stops listing the session among active demo days.

Participant controls become read-only for the closed session.

---

## 23. Final summary

The closed summary shows:

### 23.1 Session overview

```text
Demo-day name
Captain name and picture
Start time
Close time
Participant count
Completed-demo count
Total zap count
Total sats sent to presenters
```

### 23.2 Final leaderboard

```text
Rank
Project
Presenter
Final Elo
Pairwise vote count
Zap count
Sats received
Elapsed time
Overtime
```

### 23.3 Project detail

Each project shows:

```text
Demo name
Description
Optional link
Presenter name and picture
Presenter real npub
Presentation position
Start time
Finish time
Presentation time
Questions time
Overtime
Final Elo
What people liked
What people learned
Zaps and zap comments
```

Timing is derived from the recorded run:

```typescript
const elapsed = finished_at_ms - started_at_ms;

const presentation = Math.min(elapsed, PRESENTATION_MS);

const questions = Math.min(
  Math.max(elapsed - PRESENTATION_MS, 0),
  QUESTIONS_MS
);

const overtime = Math.max(
  elapsed - PRESENTATION_MS - QUESTIONS_MS,
  0
);
```

---

## 24. Follow suggestions after closure

After closure, every participant sees:

```text
Stay connected

Follow the people you met today from your usual Nostr account.
```

All suggestions use real pubkeys, never ephemeral demo-day pubkeys.

### 24.1 Load the viewer's current follows

The viewer's real pubkey comes from their local identity and participant entry.

The app queries the default relays plus the viewer's account-specific relays for the latest kind-`3` event:

```json
{
  "kinds": [3],
  "authors": ["<viewer-real-pubkey>"],
  "limit": 1
}
```

A real account is already followed when its pubkey appears in a `p` tag in the latest resolved kind-`3` event.

### 24.2 Follow list not found

If no follow list is found, the app asks for a relay rather than assuming the participant follows nobody:

```text
Follow list not found on the known relays

Paste a relay used by your usual Nostr client.

[ wss://relay.example.com                         ]

[ Search relay ]
```

The successful relay is added to `real_account_relays` and reused for future account lookups.

### 24.3 Suggestion algorithm

```typescript
const allRealParticipantPubkeys = new Set(
  closedSnapshotEntries
    .map((entry) => entry.real_pubkey)
    .filter(isValidHexPubkey)
);

const alreadyFollowing = new Set(
  latestFollowEvent.tags
    .filter((tag) => tag[0] === "p" && isValidHexPubkey(tag[1]))
    .map((tag) => tag[1])
);

const suggestions = [...allRealParticipantPubkeys].filter(
  (pubkey) =>
    pubkey !== viewerRealPubkey &&
    !alreadyFollowing.has(pubkey)
);
```

The app:

- Deduplicates repeated real pubkeys.
- Excludes the viewer's own real pubkey.
- Excludes every account already present in the viewer's follow list.
- Uses only participants included in the closed snapshot.
- Never suggests ephemeral pubkeys.

### 24.4 Suggestion UI

```text
[Avatar] Alice
Engineer working on sovereign systems

npub1realaccount...

[ Open in Nostr ]   [ Copy npub ]
```

The page also offers:

```text
[ Copy all remaining npubs ]
[ Refresh follows ]
```

`Open in Nostr` uses:

```text
nostr:npub1...
```

The application cannot follow on the participant's behalf because it does not possess the normal account's private key.

After the user follows accounts in their normal client, **Refresh follows** reloads kind `3` and removes newly followed accounts from the suggestions.

When no suggestions remain:

```text
You already follow everyone from this demo day.
```

---

## 25. Downloadable AI-ready JSON

The closed summary includes:

```text
[ Download JSON ]
```

Suggested filename:

```text
sovereign-engineering-demo-day-<date>.json
```

The export is generated client-side from the exact event IDs saved in the closed session record.

It must not contain any `nsec` or secret key.

### 25.1 Top-level example

```json
{
  "schema": "sedd-export-1",
  "generated_at": "2026-08-06T20:30:22.123Z",
  "relays": [
    "wss://relay.nostr.com",
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.primal.net",
    "wss://relay.snort.social",
    "wss://nostr.bitcoiner.social",
    "wss://nostr.mom",
    "wss://relay.nostr.band",
    "wss://offchain.pub",
    "wss://purplepag.es"
  ],

  "session": {
    "name": "SEC-08 — Week 3 Demo Day",
    "address": "30078:<captain-pubkey>:<session-d>",
    "created_at_ms": 1786032000123,
    "closed_at_ms": 1786043000123
  },

  "captain": {
    "ephemeral_pubkey": "<captain-ephemeral-pubkey>",
    "ephemeral_npub": "<captain-ephemeral-npub>",
    "real_pubkey": "<captain-real-pubkey>",
    "real_npub": "<captain-real-npub>",
    "name": "Captain name",
    "picture": "https://example.com/captain.jpg"
  },

  "participants": [],
  "demos": [],
  "personal_rankings": [],
  "elo": {},
  "totals": {},
  "raw_events": []
}
```

### 25.2 Participant object

Each participant record contains both identities and the full imported profile:

```json
{
  "ephemeral_pubkey": "<ephemeral-pubkey>",
  "ephemeral_npub": "<ephemeral-npub>",

  "real_pubkey": "<real-pubkey>",
  "real_npub": "<real-npub>",

  "profile": {
    "source_event_id": "<real-kind-0-event-id>",
    "source_relay": "wss://relay.example",
    "copied_event_id": "<ephemeral-kind-0-event-id>",
    "raw_content": "{\"name\":\"alice\",\"display_name\":\"Alice\",...}",
    "parsed_content": {
      "name": "alice",
      "display_name": "Alice",
      "about": "Engineer",
      "picture": "https://example.com/avatar.jpg",
      "banner": "https://example.com/banner.jpg",
      "website": "https://example.com",
      "nip05": "alice@example.com",
      "lud16": "alice@example.com",
      "custom_field": {
        "anything": "may be here"
      }
    },
    "source_tags": []
  },

  "entry_event_id": "<participant-entry-event-id>"
}
```

### 25.3 Demo object

```json
{
  "owner_ephemeral_pubkey": "<ephemeral-pubkey>",
  "presenter_real_pubkey": "<real-pubkey>",
  "presenter_real_npub": "<real-npub>",

  "name": "Nostr-powered sensor network",
  "description": "A local-first environmental sensor system...",
  "link": "https://example.com/project",

  "presentation": {
    "position": 1,
    "started_at_ms": 1786032600123,
    "finished_at_ms": 1786033098456,
    "presentation_ms": 360000,
    "questions_ms": 120000,
    "overtime_ms": 18333,
    "total_ms": 498333
  },

  "elo": {
    "rank": 1,
    "rating": 1587.342811
  },

  "feedback": [
    {
      "author_ephemeral_pubkey": "<reviewer-pubkey>",
      "author_real_pubkey": "<reviewer-real-pubkey>",
      "author_name": "Bob",
      "liked": "The failure demonstration made the design clear.",
      "learned": "I learned how the client resolves replaceable events."
    }
  ],

  "zap_recipient": {
    "pubkey": "<presenter-real-pubkey>",
    "npub": "<presenter-real-npub>",
    "source_profile_event_id": "<real-kind-0-event-id>",
    "source_profile_relay": "wss://relay.example",
    "lud16": "alice@example.com",
    "lud06": null
  },

  "zaps": {
    "count": 4,
    "total_msat": 42000000,
    "total_sats": 42000,
    "receipts": [
      {
        "event_id": "<receipt-id>",
        "recipient_real_pubkey": "<presenter-real-pubkey>",
        "target_entry_address": "30078:<ephemeral-pubkey>:<entry-d>",
        "sender_pubkey": "<sender-or-null>",
        "amount_msat": 21000000,
        "amount_sats": 21000,
        "comment": "Great demo"
      }
    ]
  }
}
```

### 25.4 Elo export

```json
{
  "initial_rating": 1500,
  "k": 32,
  "scale": 400,
  "pair_order": "presentation-order",
  "final": [
    {
      "rank": 1,
      "demo_owner_ephemeral_pubkey": "<pubkey>",
      "rating": 1587.342811
    }
  ],
  "pairs": [
    {
      "demo_a": "<ephemeral-pubkey-a>",
      "demo_b": "<ephemeral-pubkey-b>",
      "votes_a_over_b": 8,
      "votes_b_over_a": 3,
      "actual_score_a": 0.7272727273
    }
  ]
}
```

### 25.5 Totals

```json
{
  "participants": 17,
  "completed_demos": 17,
  "feedback_responses": 212,
  "zap_count": 38,
  "zap_sats_to_presenters": 275000,
  "presentation_ms": 6120000,
  "questions_ms": 1830000,
  "overtime_ms": 283000
}
```

### 25.6 Raw source events

`raw_events` contains the complete signed Nostr events referenced by the closed session snapshot:

```json
{
  "id": "...",
  "pubkey": "...",
  "created_at": 1786032000,
  "kind": 30078,
  "tags": [],
  "content": "...",
  "sig": "..."
}
```

This keeps the export self-contained and preserves provenance for AI processing or independent verification.

Personalized follow suggestions are not included in the shared export because they depend on the current viewer's latest follow list. The export includes every participant's real pubkey, which is sufficient to calculate them later.

---

## 26. Validation and conflict handling

### 26.1 Session authority

Only the selected session author's events may update that session coordinate.

### 26.2 Participant authority

A participant can replace only their own entry because the event author is part of the addressable coordinate.

### 26.3 Replaceable-event resolution

Across all relays:

1. Deduplicate by event ID.
2. Group by `kind + pubkey + d`.
3. Select the greatest `created_at`.
4. On equal timestamps, select the lexicographically lower event ID.

### 26.4 Valid participant entry

A participant entry counts only when:

- Its signature is valid.
- Its kind is `30078`.
- It has `t = sedd-entry`.
- Its `a` tag equals the selected session address.
- Its content parses as the expected entry schema.
- Its `real_pubkey` is a valid hex pubkey.
- Its demo name and description are nonempty.

### 26.5 Duplicate real accounts

Two ephemeral identities may claim the same real pubkey. The app does not prevent this.

For follow suggestions, duplicate real pubkeys are shown only once.

### 26.6 Missing or broken profile fields

The entire source profile is still copied. The UI uses fallbacks:

- Missing name: shortened real `npub`.
- Missing picture or broken image: generated identicon.
- Missing Lightning address: zap unavailable.

### 26.7 Relay failure

The app remains usable while at least one default relay is reachable.

A publication is shown as saved after the first positive relay acknowledgement.

### 26.8 Closed-session behavior

After `closed_at_ms` is set:

- Ranking controls are disabled.
- Feedback controls are disabled.
- Demo editing is disabled for that session.
- Captain timer controls are disabled.
- The summary and follow suggestions remain available.

---

## 27. Required application views

### Home

- Active demo-day cards.
- Captain name and picture.
- Participant count.
- Current project.
- **Join** and **Display** actions.
- **Start a demo day** action.

### Participant onboarding

- Normal `npub` input.
- Profile preview.
- Add-relay fallback.
- Demo name.
- Demo description.
- Optional demo link.

### Participant session

- Current project and timer.
- Presenter zap action.
- Project directory.
- Feedback forms.
- Personal drag-and-drop ranking.
- Live Elo leaderboard.

### Captain session

- Everything in participant view.
- Project selector.
- **GO!**.
- **START TIMER**.
- **RESTART**.
- **DONE**.
- **CLOSE DEMO DAY**.

### Display mode

- Project name.
- Description in ready state.
- Presentation countdown.
- Questions countdown.
- Overtime count-up.

### Closed summary

- Final leaderboard.
- Session totals.
- Project details.
- Feedback.
- Presenter zaps.
- Follow suggestions.
- JSON download.

---

## 28. Acceptance criteria

The implementation is complete when all of the following are true:

1. Opening the app lists active demo days from the hardcoded relay pool.
2. Each card shows the captain's name from the captain's copied kind-`0` event.
3. Each card shows the current number of unique participant entries.
4. Clicking a session pins its author as the trusted captain for that client.
5. A display computer can select an active session without publishing an entry.
6. A new browser generates and retains an ephemeral keypair locally.
7. Onboarding asks for the participant's normal `npub`, not name or picture fields.
8. The complete source kind-`0` content and tags are republished under the ephemeral pubkey.
9. If no profile is found, the app asks the user to add a relay.
10. The app never asks the user to republish their normal profile.
11. A participant publishes one replaceable entry containing their real pubkey, demo, ranking, and feedback.
12. Editing the demo replaces the same entry coordinate.
13. The captain is also represented by an ordinary participant entry.
14. The captain can select any unpresented demo and press **GO!**.
15. Every connected client then shows that demo's latest name and description.
16. The captain can start the timer with one session timestamp.
17. The timer displays six minutes of presentation time, two minutes of questions, and then overtime counting up.
18. No separate timer event or heartbeat is required.
19. Marking a demo done records its start and finish times and enables feedback and ranking.
20. Participant rankings are converted into pairwise preferences.
21. Every client computes the same Elo leaderboard from the same latest entries and presentation order.
22. The live leaderboard updates whenever a ranking entry changes.
23. A zap uses the presenter's real pubkey as `p` and the participant-entry address as `a`.
24. Zaps never affect Elo.
25. Closing the demo day stores final Elo and exact snapshot event IDs in the session event.
26. Closed sessions disappear from the active-session list.
27. The closed summary provides downloadable normalized JSON plus raw signed events.
28. The JSON contains no secret keys.
29. Follow suggestions use real pubkeys only.
30. The viewer's own real pubkey and already-followed accounts are excluded.
31. If the real follow list is not found, the app asks the viewer to add a relay.
32. There is no relay settings screen, roster event, schedule event, co-presenter model, or open/live distinction.

---

## 29. Final system model

```text
Ten hardcoded relays

Kind 0
  Complete normal profile copied under the local ephemeral pubkey

Kind 3
  Read-only lookup of the normal account's existing follows

Kind 30078
  One captain-owned session event
  One participant-owned entry per participant per session

Kinds 9734 and 9735
  Presenter zap request and receipt
```

The captain session event contains:

```text
Demo-day name
Current demo
Timer start timestamp
Completed presentation order and timing
Closed timestamp
Final Elo
Snapshot event IDs
```

Each participant entry contains:

```text
Real pubkey
Source-profile reference
Demo information
Personal ranking
Liked feedback
Learned feedback
```

The resulting flow is:

```text
Open app
  → See active demo days
  → Select a session and trust its author as captain
  → Paste normal npub
  → Find the complete normal profile
  → Add a profile relay only when necessary
  → Republish the complete profile under an ephemeral pubkey
  → Enter demo name, description, and optional link
  → Captain selects a demo and presses GO!
  → Captain starts the timer
  → Everyone sees the current demo and can zap the presenter
  → Participants provide feedback and rank completed demos
  → Live Elo rankings update
  → Captain closes the demo day
  → Everyone sees the final summary and downloads JSON
  → Each participant is shown real accounts they do not already follow
```
