import type { NostrEvent } from "./types.js";
import { isValidHexPubkey } from "./utils.js";

export function calculateFollowSuggestions({
  ownRealPubkey,
  participantRealPubkeys,
  followEvent,
}: {
  ownRealPubkey: string;
  participantRealPubkeys: string[];
  followEvent: NostrEvent;
}): string[] {
  const followed = new Set(
    followEvent.tags
      .filter((tag) => tag[0] === "p" && isValidHexPubkey(tag[1]))
      .map((tag) => tag[1] as string),
  );

  return [...new Set(participantRealPubkeys)]
    .filter(isValidHexPubkey)
    .filter((pubkey) => pubkey !== ownRealPubkey && !followed.has(pubkey))
    .sort();
}
