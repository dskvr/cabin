import type { ProvisionedWeek } from "./cohort.js";
import { isValidHexPubkey } from "./utils.js";

export function isAssignedCaptain(slot: Pick<ProvisionedWeek, "captain_pubkey">, pubkey: string): boolean {
  return isValidHexPubkey(pubkey) && slot.captain_pubkey === pubkey.toLowerCase();
}
