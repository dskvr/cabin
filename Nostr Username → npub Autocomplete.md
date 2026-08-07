# Nostr Username → npub Autocomplete

## Overview

This document describes an end-to-end solution for building a username autocomplete field for Nostr.

The desired UX is:

1. A user begins typing a Nostr username.
2. After at least four characters have been entered, the application searches for matching profiles.
3. A dropdown appears with the best matches.
4. Each result shows:
   - Avatar
   - Display name
   - Username
   - Optional NIP-05 identifier
   - `npub`
5. The user selects the correct profile.
6. The application stores the selected Nostr public key and/or `npub`.

Example:

```text
┌─────────────────────────────────────────────────────────────┐
│ Search username…                                      ×    │
├─────────────────────────────────────────────────────────────┤
│ [avatar]  G Sovereignty                                    │
│           @gsovereignty                                    │
│           npub1mygerccwqpzyh9pvp6pv44rskv40zutk...         │
│                                                             │
│ [avatar]  Sovereignty                                      │
│           @sovereignty                                     │
│           npub1abcd...                                     │
└─────────────────────────────────────────────────────────────┘
```

The implementation uses two pieces of the Nostr ecosystem:

1. **Vertex Search Profiles** to turn a username/search string into ranked Nostr public keys.
2. **Nostr kind-0 metadata events** to obtain usernames, display names, avatars, and related profile information.

Vertex's Search Profiles service explicitly supports profile searching and autocomplete-style use cases and powers the search functionality on `npub.world`.

---

# Architecture

The complete flow is:

```text
Browser
   │
   │ User types "gsover"
   ▼
Your API
GET /api/nostr/search?q=gsover
   │
   │
   ├── 1. Create signed kind-5315 event
   │
   ├── 2. POST event to Vertex DVM API
   │
   ├── 3. Receive ranked hex pubkeys
   │
   ├── 4. Query kind-0 metadata for those pubkeys
   │
   ├── 5. Convert hex pubkeys → npubs
   │
   └── 6. Return normalized profile objects
   │
   ▼
Browser dropdown
```

A normalized result returned to the browser might look like:

```json
{
  "pubkey": "d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075",
  "npub": "npub1mygerccwqpzyh9pvp6pv44rskv40zutkfs38t0hqhkvnwlhagp6s3psn5p",
  "name": "gsovereignty",
  "displayName": "G Sovereignty",
  "picture": "https://example.com/avatar.jpg",
  "nip05": "gsovereignty@example.com",
  "rank": 8.2248
}
```

---

# Why two lookups are required

Vertex Search Profiles returns ranked Nostr public keys, not complete user profiles.

The response contains objects approximately like:

```json
[
  {
    "pubkey": "d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075",
    "rank": 8.2248
  }
]
```

The `pubkey` is the normal 64-character hexadecimal Nostr public key.

The user's username and avatar live in a different place: their Nostr **kind-0 metadata event**.

NIP-01 defines kind `0` as user metadata. Its JSON content normally contains fields such as `name`, `about`, and `picture`, and additional fields are commonly included by clients. Kind-0 events are replaceable, meaning the latest profile event supersedes older ones.

Therefore:

```text
Vertex search
    ↓
pubkeys
    ↓
kind-0 metadata lookup
    ↓
names + avatars + npubs
```

---

# Vertex Search Profiles API

## Endpoint

Vertex supports an HTTP transport for its DVM services.

```text
POST https://relay.vertexlab.io/api/v1/dvms
```

The POST body is **not** a conventional search JSON object.

You must send a **signed Nostr event**.

---

# Event kinds

The Search Profiles service uses:

```text
Request:  5315
Response: 6315
Error:    7000
```



---

# Search request

A request uses Nostr event kind:

```text
5315
```

Parameters are placed into Nostr event tags using this form:

```json
["param", "<parameter>", "<value>"]
```

For example:

```json
{
  "kind": 5315,
  "created_at": 1786080000,
  "tags": [
    ["param", "search", "gsovereignty"],
    ["param", "limit", "8"]
  ],
  "content": ""
}
```

That object is only the **event template**.

Before sending it to Vertex, it must have:

```text
pubkey
id
sig
```

added by signing the event.

A complete event resembles:

```json
{
  "id": "7a0058...",
  "pubkey": "79be66...",
  "created_at": 1786080000,
  "kind": 5315,
  "tags": [
    ["param", "search", "gsovereignty"],
    ["param", "limit", "8"]
  ],
  "content": "",
  "sig": "e64ce6..."
}
```

Vertex requires Search Profile requests to be signed Nostr events.

---

# Search parameters

The useful parameters are:

| Parameter | Required | Purpose |
|---|---:|---|
| `search` | Yes | Username/name/search string |
| `limit` | No | Maximum number of returned results |
| `sort` | No | Reputation/ranking algorithm |
| `source` | No | Pubkey used as the point of view for personalized ranking |

The default result limit is `5`, while Vertex currently permits a maximum of `100`. The search term must contain **more than three characters**.

For an autocomplete field, something like this is reasonable:

```json
[
  ["param", "search", "gsover"],
  ["param", "limit", "8"]
]
```

You generally do not need 100 results in a dropdown.

Five to ten matches is usually enough.

---

# Sorting

Vertex's default search sort is:

```text
globalPagerank
```

Vertex combines textual search relevance with its reputation ranking when computing the returned rank. Results are returned in descending rank order.

For a general username selector, leaving the default ranking is a sensible starting point.

Do not alphabetically re-sort the results afterward unless you have a specific reason to do so.

The first result is intended to be the strongest combination of:

```text
text match
+
reputation
```

---

# Vertex response

A successful response is a signed Nostr event of kind:

```text
6315
```

Its `content` property is itself a JSON-encoded string.

For example, the response might conceptually look like:

```json
{
  "kind": 6315,
  "content": "[{\"pubkey\":\"d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075\",\"rank\":8.2248}]"
}
```

Notice:

```text
response
└── content
    └── JSON string
        └── array of search results
```

Therefore you need to parse it:

```ts
const searchResults = JSON.parse(responseEvent.content);
```

Each result contains:

```ts
type VertexResult = {
  pubkey: string;
  rank: number;
};
```

Vertex documents the `pubkey` as a Nostr hexadecimal public key and `rank` as the computed ranking score.

---

# Vertex error responses

Errors are returned as kind:

```text
7000
```

For example, submitting only three characters may result in an error corresponding to:

```text
the search term must be longer than three characters
```



Your backend should explicitly test the returned kind:

```ts
if (event.kind === 7000) {
  throw new Error("Vertex search failed");
}
```

---

# Nostr keys: hex versus npub

Nostr itself uses the hexadecimal public key internally.

For example:

```text
d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075
```

For humans, NIP-19 defines a Bech32 representation beginning with:

```text
npub1...
```

NIP-19 explicitly describes `npub` as the human-display representation of a public key, while core protocol events and relay filters should continue using the hexadecimal representation.

Therefore your application should usually retain both:

```ts
{
  pubkey: "...hex...",
  npub: "npub1..."
}
```

Use:

```text
hex pubkey
```

for:

```text
relay queries
database identifiers
Nostr protocol operations
```

Use:

```text
npub
```

for:

```text
display
copy/paste
user-facing UI
```

---

# Recommended JavaScript library

For a modern TypeScript implementation, this guide uses:

```text
@nostr/tools
```

Install it with:

```bash
npm install @nostr/tools ws
```

The current library exposes helpers for:

- key generation
- event signing
- public-key generation
- relay connections
- NIP-19 encoding
- `npub` conversion

Its documented APIs include `generateSecretKey`, `finalizeEvent`, `SimplePool`, and `nip19.npubEncode`.

---

# Server-side versus browser-side signing

Vertex needs a signed Nostr request.

That does **not** mean you need to ask the user to sign the search request.

You can create an application-specific signing key.

Recommended architecture:

```text
Browser
    │
    │ no Nostr secret
    ▼
Your backend
    │
    │ application search signing key
    ▼
Vertex
```

Advantages include:

- your implementation is independent of NIP-07 extensions
- users do not see signing popups when typing
- you can cache searches
- you can rate-limit abuse
- you can change providers later
- browser code stays simple

The application search key does not need to be the user's key.

It should **never** be your personal Nostr private key.

Create a dedicated key whose only job is server-side service requests.

---

# Create an application signing key

Create a script:

```ts
// scripts/create-nostr-search-key.ts

import { generateSecretKey } from "@nostr/tools/pure";
import { bytesToHex } from "@noble/hashes/utils.js";

const secretKey = generateSecretKey();

console.log(bytesToHex(secretKey));
```

Run it once.

Store the resulting 64-character hexadecimal value in your environment:

```env
VERTEX_NOSTR_SECRET_KEY=your_64_character_hex_secret
```

Do not commit this value to Git.

For deployed applications, put it in your platform's secret-management system.

---

# Signing a Vertex search request

Create:

```ts
// lib/vertex.ts

import { finalizeEvent } from "@nostr/tools/pure";
import { hexToBytes } from "@noble/hashes/utils.js";

const VERTEX_API =
  "https://relay.vertexlab.io/api/v1/dvms";

const secretHex =
  process.env.VERTEX_NOSTR_SECRET_KEY;

if (!secretHex) {
  throw new Error(
    "VERTEX_NOSTR_SECRET_KEY is not configured"
  );
}

const secretKey = hexToBytes(secretHex);

export type VertexSearchResult = {
  pubkey: string;
  rank: number;
};

export async function searchVertexProfiles(
  search: string,
  limit = 8
): Promise<VertexSearchResult[]> {
  const query = search.trim();

  if (query.length <= 3) {
    return [];
  }

  const requestEvent = finalizeEvent(
    {
      kind: 5315,

      created_at: Math.floor(Date.now() / 1000),

      tags: [
        ["param", "search", query],
        ["param", "limit", String(limit)]
      ],

      content: ""
    },

    secretKey
  );

  const response = await fetch(VERTEX_API, {
    method: "POST",

    headers: {
      "Content-Type": "application/json"
    },

    body: JSON.stringify(requestEvent),

    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    throw new Error(
      `Vertex HTTP error ${response.status}`
    );
  }

  const event = await response.json();

  if (event.kind === 7000) {
    const statusTag = event.tags?.find(
      (tag: string[]) => tag[0] === "status"
    );

    throw new Error(
      statusTag?.[2] ??
        "Vertex profile search returned an error"
    );
  }

  if (event.kind !== 6315) {
    throw new Error(
      `Unexpected Vertex event kind: ${event.kind}`
    );
  }

  const results = JSON.parse(
    event.content
  ) as VertexSearchResult[];

  return results;
}
```

---

# Test Vertex independently

Before building the UI, test the search helper.

```ts
const results =
  await searchVertexProfiles(
    "gsovereignty",
    5
  );

console.log(results);
```

You should receive something conceptually similar to:

```json
[
  {
    "pubkey": "d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075",
    "rank": 8.2248
  }
]
```

At this point you have identified candidate identities, but you do **not yet have their avatars or complete display metadata**.

---

# Fetching profile metadata

A Nostr profile is stored as an event with:

```text
kind = 0
```

The event's `pubkey` identifies the person, while `content` contains a JSON string describing the profile.

A typical event might resemble:

```json
{
  "kind": 0,
  "pubkey": "d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075",
  "content": "{\"name\":\"gsovereignty\",\"display_name\":\"G Sovereignty\",\"picture\":\"https://example.com/avatar.jpg\"}"
}
```

After parsing:

```ts
const metadata =
  JSON.parse(event.content);
```

you may have:

```json
{
  "name": "gsovereignty",
  "display_name": "G Sovereignty",
  "picture": "https://example.com/avatar.jpg",
  "about": "...",
  "nip05": "gsovereignty@example.com",
  "website": "https://example.com"
}
```

---

# Batch profile requests

Do **not** fetch each result individually.

Avoid:

```text
search result 1 → relay request
search result 2 → relay request
search result 3 → relay request
search result 4 → relay request
...
```

Instead query all matching pubkeys together.

NIP-01 relay filters allow an `authors` array, so a single filter can request kind-0 events from several public keys.

Conceptually:

```json
{
  "kinds": [0],
  "authors": [
    "pubkey1",
    "pubkey2",
    "pubkey3",
    "pubkey4"
  ]
}
```

---

# Configure the relay client in Node.js

`@nostr/tools` recommends using `SimplePool` when interacting with relays. In Node.js, its documentation calls for a WebSocket implementation such as `ws`.

Create:

```ts
// lib/nostr-relay.ts

import {
  SimplePool,
  useWebSocketImplementation
} from "@nostr/tools/pool";

import WebSocket from "ws";

useWebSocketImplementation(WebSocket);

export const pool = new SimplePool();
```

---

# Choose profile relays

You can start with Vertex itself:

```ts
export const PROFILE_RELAYS = [
  "wss://relay.vertexlab.io"
];
```

For greater resilience, you can optionally query multiple relays:

```ts
export const PROFILE_RELAYS = [
  "wss://relay.vertexlab.io",
  "wss://relay.damus.io",
  "wss://relay.primal.net"
];
```

With several relays, the same kind-0 event may appear more than once.

Your enrichment code should therefore choose the newest event per public key.

This aligns with kind `0` being a replaceable event under NIP-01.

---

# Fetch several profiles at once

```ts
// lib/profiles.ts

import { pool } from "./nostr-relay";

const PROFILE_RELAYS = [
  "wss://relay.vertexlab.io"
];

export type NostrMetadata = {
  name?: string;
  display_name?: string;
  picture?: string;
  about?: string;
  nip05?: string;
  website?: string;
};

export async function fetchProfiles(
  pubkeys: string[]
) {
  if (pubkeys.length === 0) {
    return new Map();
  }

  const events = await pool.querySync(
    PROFILE_RELAYS,
    {
      kinds: [0],
      authors: pubkeys
    }
  );

  const newestByPubkey = new Map<
    string,
    (typeof events)[number]
  >();

  for (const event of events) {
    const existing =
      newestByPubkey.get(event.pubkey);

    if (
      !existing ||
      event.created_at >
        existing.created_at
    ) {
      newestByPubkey.set(
        event.pubkey,
        event
      );
    }
  }

  const profiles = new Map<
    string,
    NostrMetadata
  >();

  for (
    const [pubkey, event]
    of newestByPubkey
  ) {
    try {
      const metadata =
        JSON.parse(event.content);

      profiles.set(
        pubkey,
        metadata
      );
    } catch {
      profiles.set(
        pubkey,
        {}
      );
    }
  }

  return profiles;
}
```

The Nostr Tools documentation provides `SimplePool` and `querySync()` for querying multiple matching relay events.

---

# Converting hex public keys to npub

Use NIP-19 support from `@nostr/tools`:

```ts
import * as nip19
  from "@nostr/tools/nip19";

const npub =
  nip19.npubEncode(hexPubkey);
```

The library's current documentation explicitly demonstrates `nip19.npubEncode(pk)` for this conversion.

NIP-19 defines this representation specifically for displaying Nostr public keys to users.

---

# Combine search results and metadata

Create:

```ts
// lib/search-nostr-users.ts

import * as nip19
  from "@nostr/tools/nip19";

import {
  searchVertexProfiles
} from "./vertex";

import {
  fetchProfiles
} from "./profiles";

export type NostrUserSearchResult = {
  pubkey: string;
  npub: string;

  name?: string;
  displayName?: string;
  picture?: string;
  nip05?: string;

  rank: number;
};

export async function searchNostrUsers(
  search: string
): Promise<
  NostrUserSearchResult[]
> {
  const vertexResults =
    await searchVertexProfiles(
      search,
      8
    );

  if (
    vertexResults.length === 0
  ) {
    return [];
  }

  const pubkeys =
    vertexResults.map(
      result => result.pubkey
    );

  const profiles =
    await fetchProfiles(pubkeys);

  return vertexResults.map(
    result => {
      const metadata =
        profiles.get(
          result.pubkey
        ) ?? {};

      return {
        pubkey:
          result.pubkey,

        npub:
          nip19.npubEncode(
            result.pubkey
          ),

        name:
          metadata.name,

        displayName:
          metadata.display_name,

        picture:
          metadata.picture,

        nip05:
          metadata.nip05,

        rank:
          result.rank
      };
    }
  );
}
```

Importantly, this preserves the ranking order returned by Vertex.

---

# Result interface

Your frontend-facing result now looks like:

```ts
export type NostrUserSearchResult = {
  /**
   * Canonical Nostr public key.
   * Use this internally.
   */
  pubkey: string;

  /**
   * Human-friendly NIP-19 key.
   */
  npub: string;

  /**
   * Short username.
   */
  name?: string;

  /**
   * Human-facing profile name.
   */
  displayName?: string;

  /**
   * Avatar URL.
   */
  picture?: string;

  /**
   * Optional NIP-05 identifier.
   */
  nip05?: string;

  /**
   * Vertex search ranking.
   */
  rank: number;
};
```

---

# Build the application API endpoint

The frontend should not need to understand Vertex events or Nostr relay queries.

Expose one application-specific API:

```text
GET /api/nostr/search?q=gsover
```

The response should be simple JSON:

```json
{
  "results": [
    {
      "pubkey": "d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075",
      "npub": "npub1mygerccwqpzyh9pvp6pv44rskv40zutkfs38t0hqhkvnwlhagp6s3psn5p",
      "name": "gsovereignty",
      "displayName": "G Sovereignty",
      "picture": "https://example.com/avatar.jpg",
      "rank": 8.2248
    }
  ]
}
```

---

# Next.js App Router example

For Next.js:

```text
app/
└── api/
    └── nostr/
        └── search/
            └── route.ts
```

Create:

```ts
// app/api/nostr/search/route.ts

import {
  NextRequest,
  NextResponse
} from "next/server";

import {
  searchNostrUsers
} from "@/lib/search-nostr-users";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest
) {
  const q =
    request.nextUrl
      .searchParams
      .get("q")
      ?.trim() ?? "";

  if (q.length <= 3) {
    return NextResponse.json({
      results: []
    });
  }

  if (q.length > 100) {
    return NextResponse.json(
      {
        error:
          "Search query is too long"
      },
      {
        status: 400
      }
    );
  }

  try {
    const results =
      await searchNostrUsers(q);

    return NextResponse.json({
      results
    });
  } catch (error) {
    console.error(
      "Nostr profile search failed",
      error
    );

    return NextResponse.json(
      {
        error:
          "Profile search unavailable"
      },
      {
        status: 502
      }
    );
  }
}
```

---

# Test the application endpoint

Once running locally:

```bash
curl \
  "http://localhost:3000/api/nostr/search?q=gsovereignty"
```

Expected shape:

```json
{
  "results": [
    {
      "pubkey": "...",
      "npub": "npub1...",
      "name": "gsovereignty",
      "displayName": "G Sovereignty",
      "picture": "https://...",
      "nip05": "...",
      "rank": 8.2248
    }
  ]
}
```

---

# Frontend autocomplete behavior

Do not issue a search after every individual keystroke immediately.

Use this behavior:

```text
0 chars
   ↓
nothing

1 char
   ↓
nothing

2 chars
   ↓
nothing

3 chars
   ↓
nothing

4+ chars
   ↓
wait 300 ms
   ↓
search
```

A delay of roughly:

```text
250–400 ms
```

works well for autocomplete.

For example:

```text
user types:
g
gs
gso
gsov
gsove
gsover

Only the latest settled value:
gsover

causes a request.
```

This significantly reduces traffic.

---

# Cancel obsolete searches

Consider this sequence:

```text
gsover
    ↓ request A

gsovere
    ↓ request B

gsovereignty
    ↓ request C
```

Request A could theoretically finish after C.

Without protection, the user might briefly see results for an older query.

Use:

```text
AbortController
```

to cancel the previous request whenever the input changes.

---

# React autocomplete example

```tsx
"use client";

import {
  useEffect,
  useState
} from "react";

type NostrUser = {
  pubkey: string;
  npub: string;
  name?: string;
  displayName?: string;
  picture?: string;
  nip05?: string;
  rank: number;
};

type Props = {
  onSelect:
    (user: NostrUser) => void;
};

export function NostrUserSearch({
  onSelect
}: Props) {
  const [
    query,
    setQuery
  ] = useState("");

  const [
    results,
    setResults
  ] = useState<
    NostrUser[]
  >([]);

  const [
    loading,
    setLoading
  ] = useState(false);

  const [
    open,
    setOpen
  ] = useState(false);

  useEffect(() => {
    const search =
      query.trim();

    if (
      search.length <= 3
    ) {
      setResults([]);
      setOpen(false);
      setLoading(false);

      return;
    }

    const controller =
      new AbortController();

    const timer =
      setTimeout(
        async () => {
          try {
            setLoading(true);

            const response =
              await fetch(
                `/api/nostr/search?q=${
                  encodeURIComponent(
                    search
                  )
                }`,
                {
                  signal:
                    controller.signal
                }
              );

            if (!response.ok) {
              throw new Error(
                "Search failed"
              );
            }

            const data =
              await response.json();

            setResults(
              data.results
            );

            setOpen(true);
          } catch (error) {
            if (
              error instanceof
                DOMException &&
              error.name ===
                "AbortError"
            ) {
              return;
            }

            console.error(
              error
            );

            setResults([]);
          } finally {
            setLoading(false);
          }
        },
        300
      );

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="nostr-search">
      <input
        value={query}
        onChange={event => {
          setQuery(
            event.target.value
          );
        }}
        onFocus={() => {
          if (
            results.length
          ) {
            setOpen(true);
          }
        }}
        placeholder="Search Nostr username"
        autoComplete="off"
      />

      {loading && (
        <div className="search-status">
          Searching…
        </div>
      )}

      {open &&
        results.length > 0 && (
          <div
            className="nostr-results"
            role="listbox"
          >
            {results.map(
              user => (
                <button
                  key={
                    user.pubkey
                  }
                  type="button"
                  className=
                    "nostr-result"
                  onClick={() => {
                    onSelect(
                      user
                    );

                    setQuery(
                      user.name ??
                        user.displayName ??
                        user.npub
                    );

                    setOpen(
                      false
                    );
                  }}
                >
                  <ProfileAvatar
                    user={
                      user
                    }
                  />

                  <div className=
                    "nostr-result-content"
                  >
                    <div className=
                      "nostr-display-name"
                    >
                      {
                        user.displayName ??
                        user.name ??
                        "Unnamed profile"
                      }
                    </div>

                    {user.name && (
                      <div className=
                        "nostr-username"
                      >
                        @{
                          user.name
                        }
                      </div>
                    )}

                    {user.nip05 && (
                      <div className=
                        "nostr-nip05"
                      >
                        {
                          user.nip05
                        }
                      </div>
                    )}

                    <div className=
                      "nostr-npub"
                    >
                      {
                        user.npub
                      }
                    </div>
                  </div>
                </button>
              )
            )}
          </div>
        )}
    </div>
  );
}
```

---

# Avatar component

Never assume a profile image URL will load successfully.

Profiles can contain:

- missing images
- dead links
- broken URLs
- slow hosts
- unsupported formats

Create a fallback.

```tsx
import {
  useState
} from "react";

function ProfileAvatar({
  user
}: {
  user: {
    picture?: string;
    name?: string;
    displayName?: string;
  };
}) {
  const [
    failed,
    setFailed
  ] = useState(false);

  if (
    !user.picture ||
    failed
  ) {
    const label =
      user.displayName ??
      user.name ??
      "?";

    return (
      <div
        className=
          "avatar-fallback"
      >
        {label
          .slice(0, 1)
          .toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={user.picture}
      alt=""
      className=
        "nostr-avatar"
      width={40}
      height={40}
      loading="lazy"
      onError={() =>
        setFailed(true)
      }
    />
  );
}
```

---

# Suggested result-row design

A useful result row is:

```text
[avatar]  G Sovereignty
          @gsovereignty
          gsovereignty@example.com
          npub1mygerccwqpzyh9pvp6pv44rsk...
```

Recommended hierarchy:

```text
display_name
    ↓
@name
    ↓
nip05
    ↓
npub
```

For example:

```tsx
<div>
  <strong>
    {user.displayName ||
      user.name ||
      "Unnamed profile"}
  </strong>

  {user.name && (
    <div>
      @{user.name}
    </div>
  )}

  {user.nip05 && (
    <div>
      {user.nip05}
    </div>
  )}

  <div>
    {truncateNpub(
      user.npub
    )}
  </div>
</div>
```

---

# Displaying the npub

An `npub` is long.

For dropdown display, you may want:

```text
npub1mygerccwqpzyh9pvp...3psn5p
```

while retaining the complete value internally.

Example:

```ts
export function truncateNpub(
  npub: string
) {
  if (npub.length < 28) {
    return npub;
  }

  return (
    npub.slice(0, 20) +
    "…" +
    npub.slice(-8)
  );
}
```

When appropriate, use:

```html
title={user.npub}
```

so desktop users can inspect the complete value.

If identity selection is particularly sensitive, you can display the entire `npub`.

---

# What to store when the user selects a result

Store the **hex public key** as the canonical identity.

For example:

```ts
{
  nostrPubkey:
    "d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075"
}
```

Optionally store the `npub` as well:

```ts
{
  nostrPubkey:
    "d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075",

  nostrNpub:
    "npub1mygerccwqpzyh9pvp6pv44rskv40zutkfs38t0hqhkvnwlhagp6s3psn5p"
}
```

However, the `npub` can always be regenerated from the hexadecimal public key.

NIP-19 recommends using binary or hexadecimal values internally and treating Bech32 identifiers such as `npub` primarily as user-facing representations.

---

# Do not use the username as identity

This is extremely important.

Do **not** store:

```text
gsovereignty
```

as the user's Nostr identity.

Nostr identities are public keys.

A username is only metadata associated with that public key.

Two different pubkeys can have:

```text
name = "gsovereignty"
```

at the same time.

A person can also change:

```text
gsovereignty
```

to:

```text
gsovereignty2
```

without changing their Nostr identity.

The invariant is:

```text
identity = pubkey
```

not:

```text
identity = username
```

---

# Why show NIP-05

Because usernames are not unique, showing NIP-05 can help the user distinguish similar results.

For example:

```text
[avatar] G Sovereignty
         @gsovereignty
         gsovereignty@nostrovia.org
         npub1myger...
```

versus:

```text
[avatar] G Sovereignty
         @gsovereignty
         somebody@example.org
         npub1abcd...
```

The user can then make a more informed choice.

Do not treat the presence of a NIP-05 string in kind-0 metadata alone as proof that it has actually been verified.

If verification matters to your application, perform NIP-05 verification separately.

---

# Exact matches

For a better UX, you can optionally promote exact username matches.

For example, if the search is:

```text
gsovereignty
```

and a result contains:

```json
{
  "name": "gsovereignty"
}
```

you could put that result first.

However, remember that Vertex has already ranked results using search relevance and reputation.

A reasonable approach is:

```text
exact case-insensitive `name` match
    ↓
Vertex rank order
```

Example:

```ts
results.sort(
  (a, b) => {
    const q =
      search.toLowerCase();

    const aExact =
      a.name?.toLowerCase()
        === q;

    const bExact =
      b.name?.toLowerCase()
        === q;

    if (
      aExact &&
      !bExact
    ) {
      return -1;
    }

    if (
      bExact &&
      !aExact
    ) {
      return 1;
    }

    return (
      b.rank -
      a.rank
    );
  }
);
```

This part is an application-level UX decision rather than a Nostr protocol requirement.

---

# Caching

Autocomplete can generate a lot of repeated searches.

For example:

```text
gsover
gsover
gsover
gsover
```

may be requested by multiple users.

Search responses can therefore be cached briefly.

A good starting point might be:

```text
Search query cache:
30–120 seconds

Profile metadata cache:
5–30 minutes
```

Profile metadata does not normally need to be fetched on every keystroke.

A simple cache key:

```text
nostr-search:gsover
```

could contain the complete normalized results.

---

# In-memory cache example

For a small application:

```ts
type CacheEntry<T> = {
  expires: number;
  value: T;
};

const searchCache =
  new Map<
    string,
    CacheEntry<
      NostrUserSearchResult[]
    >
  >();

export async function
cachedSearchNostrUsers(
  search: string
) {
  const key =
    search
      .trim()
      .toLowerCase();

  const existing =
    searchCache.get(key);

  if (
    existing &&
    existing.expires >
      Date.now()
  ) {
    return existing.value;
  }

  const value =
    await searchNostrUsers(
      search
    );

  searchCache.set(
    key,
    {
      value,
      expires:
        Date.now() +
        60_000
    }
  );

  return value;
}
```

For a horizontally scaled deployment, use a shared cache such as Redis instead.

---

# Rate limiting

Because your public API endpoint indirectly calls another service, apply rate limits.

For example:

```text
30 searches / minute / IP
```

or another limit appropriate for your user base.

Rate limiting prevents:

- scraping
- automated enumeration
- excessive Vertex traffic
- accidental runaway frontend loops
- unnecessary infrastructure cost

---

# Minimum query length

Enforce the four-character minimum in **both** places:

Frontend:

```ts
if (
  query.trim().length <= 3
) {
  return;
}
```

Backend:

```ts
if (
  q.length <= 3
) {
  return {
    results: []
  };
}
```

Do not rely only on the browser check.

Vertex itself currently requires the search string to be longer than three characters.

---

# Result limits

For dropdown autocomplete:

```text
5–8 results
```

is usually appropriate.

Example:

```ts
searchVertexProfiles(
  q,
  8
);
```

The Vertex API supports larger limits, up to the documented maximum of `100`, but returning that many profiles would generally make a poor autocomplete experience.

---

# Failure handling

There are several independent failure modes:

```text
Vertex unavailable

Vertex returns kind 7000

Relay unavailable

Profile not found

Malformed kind-0 metadata

Avatar unavailable

Slow request

User changes search before request completes
```

Each should degrade gracefully.

---

# Vertex succeeds but profile metadata is missing

This can happen.

You may know:

```text
pubkey
rank
npub
```

but not:

```text
name
picture
display_name
```

Still show the result:

```text
[ ? ]  Unknown profile
       npub1abc...
```

Example normalization:

```ts
return {
  pubkey:
    result.pubkey,

  npub:
    nip19.npubEncode(
      result.pubkey
    ),

  name:
    metadata?.name,

  displayName:
    metadata?.display_name,

  picture:
    metadata?.picture,

  nip05:
    metadata?.nip05,

  rank:
    result.rank
};
```

The absence of metadata should not invalidate the public key.

---

# Malformed profile JSON

Kind-0 content is controlled by the profile owner.

Never assume it is valid JSON.

Use:

```ts
try {
  metadata =
    JSON.parse(
      event.content
    );
} catch {
  metadata = {};
}
```

Do not allow malformed profile metadata to crash the search endpoint.

---

# Treat profile metadata as untrusted input

Fields such as:

```text
name
display_name
about
picture
website
nip05
```

are user-controlled data.

Do not inject them into HTML using:

```text
dangerouslySetInnerHTML
```

Render them as ordinary strings.

Modern React escapes strings by default.

---

# Avatar security considerations

An avatar URL causes the browser to contact an external server.

That means the avatar host can potentially see normal HTTP request metadata such as the visitor's IP address.

Depending on your application's privacy requirements, you may choose to:

1. Load avatars directly.
2. Proxy them through your server.
3. Proxy and cache them through an image service.
4. Disable remote avatars entirely.

For a normal public profile directory or selector, direct loading may be acceptable.

For privacy-sensitive applications, consider proxying.

---

# Avoid sending user private keys

Nothing in this solution requires the user's:

```text
nsec
```

or private signing key.

Do not ask the user for an `nsec`.

Do not put one into this form.

Do not use the user's Nostr identity to sign Vertex autocomplete queries unless your product has a separate, deliberate reason to do so.

The autocomplete should work before the user has authenticated with Nostr.

---

# Recommended backend boundary

The browser should ideally see:

```text
/api/nostr/search?q=gsover
```

It should **not need to know**:

```text
5315
6315
7000
Vertex DVM tags
Nostr event signing
relay filters
kind-0 parsing
```

Those are implementation details behind your API.

This gives you freedom to replace the provider later.

For example:

```text
Today:
Vertex

Future:
Vertex + NIP-50

Future:
your own index

Future:
multiple providers
```

without changing your UI.

---

# Full backend flow

The resulting backend algorithm is:

```ts
async function searchUsers(
  query: string
) {
  // 1. Validate.
  if (
    query.trim().length <= 3
  ) {
    return [];
  }

  // 2. Search Vertex.
  const candidates =
    await searchVertexProfiles(
      query,
      8
    );

  // 3. Extract pubkeys.
  const pubkeys =
    candidates.map(
      candidate =>
        candidate.pubkey
    );

  // 4. Fetch metadata
  // in one batched query.
  const metadata =
    await fetchProfiles(
      pubkeys
    );

  // 5. Join data.
  return candidates.map(
    candidate => {
      const profile =
        metadata.get(
          candidate.pubkey
        );

      return {
        pubkey:
          candidate.pubkey,

        npub:
          nip19.npubEncode(
            candidate.pubkey
          ),

        name:
          profile?.name,

        displayName:
          profile?.display_name,

        picture:
          profile?.picture,

        nip05:
          profile?.nip05,

        rank:
          candidate.rank
      };
    }
  );
}
```

---

# Full end-to-end request example

Assume the user enters:

```text
gsovereignty
```

## Step 1 — Browser

Browser sends:

```http
GET /api/nostr/search?q=gsovereignty
```

---

## Step 2 — Backend creates Vertex request

Backend creates:

```json
{
  "kind": 5315,
  "created_at": 1786080000,
  "tags": [
    [
      "param",
      "search",
      "gsovereignty"
    ],
    [
      "param",
      "limit",
      "8"
    ]
  ],
  "content": ""
}
```

---

## Step 3 — Backend signs it

Using:

```ts
finalizeEvent(
  eventTemplate,
  applicationSecretKey
);
```

The resulting object contains:

```text
id
pubkey
sig
```

in addition to the original fields.

`finalizeEvent()` is the documented Nostr Tools helper for assigning the public key, generating the event ID, and signing the event.

---

## Step 4 — Backend calls Vertex

```http
POST https://relay.vertexlab.io/api/v1/dvms
Content-Type: application/json
```

Body:

```json
{
  "id": "...",
  "pubkey": "...",
  "created_at": 1786080000,
  "kind": 5315,
  "tags": [
    [
      "param",
      "search",
      "gsovereignty"
    ],
    [
      "param",
      "limit",
      "8"
    ]
  ],
  "content": "",
  "sig": "..."
}
```

The HTTP endpoint and signed-event transport are documented by Vertex.

---

## Step 5 — Vertex returns candidates

Conceptually:

```json
{
  "kind": 6315,
  "content":
    "[{\"pubkey\":\"d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075\",\"rank\":8.2248}]"
}
```

Parse:

```ts
const candidates =
  JSON.parse(
    response.content
  );
```

---

## Step 6 — Query kind-0 events

Create the relay filter:

```json
{
  "kinds": [0],
  "authors": [
    "d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075"
  ]
}
```

NIP-01 specifies both kind-0 metadata and author-based relay filters.

---

## Step 7 — Parse metadata

Suppose the relay returns:

```json
{
  "kind": 0,
  "pubkey":
    "d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075",
  "content":
    "{\"name\":\"gsovereignty\",\"display_name\":\"G Sovereignty\",\"picture\":\"https://example.com/avatar.jpg\"}"
}
```

Parse:

```ts
const metadata =
  JSON.parse(
    event.content
  );
```

---

## Step 8 — Convert pubkey to npub

```ts
const npub =
  nip19.npubEncode(
    candidate.pubkey
  );
```

NIP-19 defines `npub` as the Bech32 representation of a Nostr public key.

---

## Step 9 — Return browser-friendly object

```json
{
  "results": [
    {
      "pubkey":
        "d91191e30e00444b942c0e82cad470b32af171764c2275bee0bd99377efd4075",

      "npub":
        "npub1mygerccwqpzyh9pvp6pv44rskv40zutkfs38t0hqhkvnwlhagp6s3psn5p",

      "name":
        "gsovereignty",

      "displayName":
        "G Sovereignty",

      "picture":
        "https://example.com/avatar.jpg",

      "rank":
        8.2248
    }
  ]
}
```

---

## Step 10 — Render dropdown

```text
┌──────────────────────────────────────────────────────┐
│ [avatar]  G Sovereignty                             │
│           @gsovereignty                             │
│           npub1mygerccwqpzyh9pvp6pv44rsk...         │
└──────────────────────────────────────────────────────┘
```

---

# Suggested project structure

For a Next.js project:

```text
src/
├── app/
│   └── api/
│       └── nostr/
│           └── search/
│               └── route.ts
│
├── components/
│   ├── NostrUserSearch.tsx
│   └── ProfileAvatar.tsx
│
└── lib/
    ├── vertex.ts
    ├── profiles.ts
    ├── nostr-relay.ts
    └── search-nostr-users.ts
```

The responsibilities are:

```text
vertex.ts
    Vertex username search

nostr-relay.ts
    relay connection setup

profiles.ts
    kind-0 metadata retrieval

search-nostr-users.ts
    aggregation + normalization

route.ts
    HTTP API boundary

NostrUserSearch.tsx
    autocomplete UI

ProfileAvatar.tsx
    profile-image handling
```

---

# Recommended database representation

If the selected identity becomes part of an account or record, use something like:

```sql
nostr_pubkey CHAR(64) NOT NULL
```

Optionally:

```sql
nostr_npub TEXT
```

You may also cache:

```sql
nostr_name
nostr_display_name
nostr_picture
nostr_nip05
nostr_profile_updated_at
```

But remember:

```text
name
display_name
picture
nip05
```

are mutable metadata.

The public key is the identity.

---

# Refresh profile metadata later

Suppose a user selects:

```text
@gsovereignty
```

today.

Later they update their profile picture.

If you permanently store the old picture URL and never refresh kind-0 metadata, your UI becomes stale.

A better model is:

```text
pubkey
    = permanent identity

kind-0 profile cache
    = temporary presentation data
```

Refresh profile metadata periodically or when viewing the profile.

---

# Accessibility

The autocomplete should support:

```text
Arrow Down
Arrow Up
Enter
Escape
Tab
```

and use appropriate ARIA semantics such as:

```html
role="combobox"
role="listbox"
role="option"
aria-expanded="true"
aria-controls="nostr-results"
```

For production applications, consider using an established accessible combobox primitive and customize the result rendering.

---

# Mobile behavior

Keep result rows large enough to tap.

Approximately:

```text
48–64 px minimum row height
```

is a useful target.

Avoid requiring the user to accurately tap a tiny `npub` string.

The entire result row should be selectable.

---

# Loading state

Show subtle feedback after the debounce fires:

```text
Searching…
```

Do not immediately show it on every keystroke or the UI may flicker.

---

# Empty result state

If Vertex returns no matches:

```text
No Nostr profiles found
```

Avoid saying:

```text
Username does not exist
```

because the search index may be incomplete and Nostr is distributed across relays.

---

# Optional direct npub input

A useful enhancement is allowing users to paste an `npub` directly.

Pseudo-flow:

```text
input starts with "npub1"
    ↓
decode NIP-19
    ↓
obtain hex pubkey
    ↓
fetch kind-0 profile
    ↓
show exact profile
```

This makes the selector useful even when username search cannot find someone.

---

# Optional hex public-key input

You can similarly recognize:

```text
64-character lowercase hex
```

and treat it directly as a public key.

Then:

```text
hex
    ↓
kind-0 profile lookup
    ↓
npubEncode()
    ↓
result
```

---

# Combined input logic

A polished selector can support three modes automatically:

```text
Input
  │
  ├── starts "npub1"
  │       ↓
  │   exact npub lookup
  │
  ├── 64-char hex
  │       ↓
  │   exact pubkey lookup
  │
  └── anything else
          ↓
      Vertex username search
```

This gives advanced Nostr users the ability to paste the canonical identifier while keeping username search easy for normal users.

---

# Recommended response payload

A slightly richer production API could return:

```json
{
  "query": "gsover",

  "results": [
    {
      "pubkey": "...",
      "npub": "npub1...",
      "name": "gsovereignty",
      "displayName": "G Sovereignty",
      "picture": "https://...",
      "nip05": "...",
      "rank": 8.2248
    }
  ],

  "meta": {
    "provider": "vertex"
  }
}
```

The frontend should not depend heavily on:

```text
provider = vertex
```

because you may change the backend search implementation later.

---

# Production checklist

Before deploying, verify all of the following:

- [ ] Search does not run until four characters are entered.
- [ ] Requests are debounced.
- [ ] Previous browser requests are cancelled.
- [ ] Backend validates the query.
- [ ] Vertex signing key exists only server-side.
- [ ] Signing key is a dedicated application key.
- [ ] Vertex kind `7000` errors are handled.
- [ ] Vertex HTTP errors are handled.
- [ ] Search results are limited to roughly 5–10 profiles.
- [ ] Kind-0 metadata is fetched in batches.
- [ ] Invalid profile JSON is handled.
- [ ] Missing avatars have a fallback.
- [ ] Missing metadata does not discard a valid pubkey.
- [ ] Full hexadecimal pubkeys remain available internally.
- [ ] `npub` values are generated with NIP-19 encoding.
- [ ] Usernames are not treated as unique identifiers.
- [ ] Search calls are rate-limited.
- [ ] Search/profile results are cached where appropriate.
- [ ] Avatar URLs are treated as untrusted remote resources.
- [ ] The selected value is the public key, not just the username.
- [ ] Dropdown keyboard navigation is accessible.
- [ ] Empty/error states are user friendly.

---

# Minimal version

If you want the shortest possible implementation, the system boils down to:

```ts
const candidates =
  await searchVertexProfiles(
    query
  );

const pubkeys =
  candidates.map(
    x => x.pubkey
  );

const metadata =
  await fetchProfiles(
    pubkeys
  );

const results =
  candidates.map(x => ({
    pubkey:
      x.pubkey,

    npub:
      nip19.npubEncode(
        x.pubkey
      ),

    ...metadata.get(
      x.pubkey
    ),

    rank:
      x.rank
  }));
```

Frontend:

```text
input
  ↓
300 ms debounce
  ↓
GET /api/nostr/search?q=...
  ↓
render avatar + name + username + npub
  ↓
user selects
  ↓
store hex pubkey
```

---

# Final recommended architecture

```text
┌───────────────────────────────┐
│ Browser                       │
│                               │
│ Username autocomplete         │
│                               │
│ 300 ms debounce               │
│ AbortController               │
└───────────────┬───────────────┘
                │
                │
                │ GET
                │ /api/nostr/search?q=gsover
                ▼
┌───────────────────────────────┐
│ Application backend           │
│                               │
│ validate                      │
│ cache                         │
│ rate limit                    │
└───────────────┬───────────────┘
                │
                ├─────────────────────────────┐
                │                             │
                ▼                             ▼
┌────────────────────────┐      ┌────────────────────────┐
│ Vertex Search Profiles │      │ Nostr relay            │
│                        │      │                        │
│ signed kind 5315       │      │ query kind 0          │
│        ↓               │      │ authors=[pubkeys]     │
│ kind 6315              │      │        ↓              │
│        ↓               │      │ metadata              │
│ ranked pubkeys         │      │ names + pictures      │
└─────────────┬──────────┘      └────────────┬───────────┘
              │                              │
              └──────────────┬───────────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │ Normalize results    │
                  │                      │
                  │ pubkey               │
                  │ npub                 │
                  │ name                 │
                  │ displayName          │
                  │ picture              │
                  │ nip05                │
                  │ rank                 │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │ Autocomplete         │
                  │ dropdown             │
                  │                      │
                  │ [avatar] Name        │
                  │          @username   │
                  │          npub1...    │
                  └──────────────────────┘
```

This keeps the Nostr-specific complexity behind one clean API while giving the frontend exactly the data it needs for a fast username-to-`npub` selector.

## Primary technical references

- **Vertex Search Profiles documentation** — defines the `5315` request, `6315` response, `7000` error event, HTTP endpoint, supported parameters, result structure, minimum search length, and ranking behavior.
- **NIP-01** — defines Nostr kind-0 profile metadata, replaceable-event behavior, relay filters, and author-based queries.
- **NIP-19** — defines `npub` and explains the distinction between Bech32 user-facing identifiers and hexadecimal protocol keys.
- **Nostr Tools** — provides the current TypeScript APIs used above for event signing, relay querying, key generation, WebSocket setup, and `npub` encoding.