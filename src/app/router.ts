import { APP_KIND } from "../config/relays.js";
import type { SelectedSession } from "../domain/types.js";
import { sessionAddress } from "../domain/utils.js";
import { decodeNaddr, naddrEncode } from "../nostr/bech32.js";

export type AppRoute =
  | { name: "home" }
  | { name: "create" }
  | { name: "session"; naddr: string; selected: SelectedSession }
  | { name: "display"; naddr: string; selected: SelectedSession }
  | { name: "invalid"; message: string };

export function parseRoute(hash = globalThis.location?.hash ?? "#/" ): AppRoute {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const parts = raw.split("/").filter(Boolean);
  if (parts.length === 0) return { name: "home" };
  if (parts[0] === "create") return { name: "create" };
  if ((parts[0] === "session" || parts[0] === "display") && parts[1]) {
    try {
      const decoded = decodeNaddr(parts[1]);
      if (decoded.kind !== APP_KIND) throw new Error("The address is not a demo-day session");
      const selected: SelectedSession = {
        captainPubkey: decoded.pubkey,
        d: decoded.identifier,
        address: sessionAddress(decoded.pubkey, decoded.identifier),
      };
      return { name: parts[0], naddr: parts[1], selected };
    } catch (error) {
      return { name: "invalid", message: error instanceof Error ? error.message : "Invalid session address" };
    }
  }
  return { name: "invalid", message: "Unknown page" };
}

export function sessionNaddr(captainPubkey: string, sessionD: string): string {
  return naddrEncode({
    kind: APP_KIND,
    pubkey: captainPubkey,
    identifier: sessionD,
    relays: [],
  });
}

export function navigate(path: string): void {
  globalThis.location.hash = path.startsWith("#") ? path : `#${path}`;
}
