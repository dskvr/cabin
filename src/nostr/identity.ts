import { IDENTITY_STORAGE_KEY } from "../config/relays.js";
import type { LocalIdentityV1 } from "../domain/types.js";
import { dedupe, isValidEventId, isValidHexPubkey } from "../domain/utils.js";
import { npubEncode, nsecEncode } from "./bech32.js";
import { generateSecretKeyHex, getPublicKey } from "./crypto.js";

function storageOrNull(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function validIdentity(value: unknown): value is LocalIdentityV1 {
  if (typeof value !== "object" || value === null) return false;
  const identity = value as Partial<LocalIdentityV1>;
  if (identity.version !== 1) return false;
  if (typeof identity.secret_key_hex !== "string" || !/^[0-9a-f]{64}$/.test(identity.secret_key_hex)) return false;
  if (!isValidHexPubkey(identity.public_key_hex)) return false;
  if (typeof identity.nsec !== "string" || typeof identity.npub !== "string") return false;
  if (!(identity.real_pubkey_hex === null || isValidHexPubkey(identity.real_pubkey_hex))) return false;
  if (!(identity.real_npub === null || typeof identity.real_npub === "string")) return false;
  if (!(identity.source_profile_event_id === null || isValidEventId(identity.source_profile_event_id))) return false;
  if (!(identity.source_profile_relay === null || typeof identity.source_profile_relay === "string")) return false;
  if (!Array.isArray(identity.real_account_relays) || !identity.real_account_relays.every((relay) => typeof relay === "string")) return false;
  if (!(identity.copied_profile_event_id === null || isValidEventId(identity.copied_profile_event_id))) return false;
  if (typeof identity.created_at_ms !== "number" || !Number.isSafeInteger(identity.created_at_ms)) return false;
  if (!(identity.profile_refreshed_at_ms === null || (typeof identity.profile_refreshed_at_ms === "number" && Number.isSafeInteger(identity.profile_refreshed_at_ms)))) return false;
  try {
    return getPublicKey(identity.secret_key_hex) === identity.public_key_hex;
  } catch {
    return false;
  }
}

export function createIdentity(): LocalIdentityV1 {
  const secret = generateSecretKeyHex();
  const publicKey = getPublicKey(secret);
  const identity: LocalIdentityV1 = {
    version: 1,
    secret_key_hex: secret,
    public_key_hex: publicKey,
    nsec: nsecEncode(secret),
    npub: npubEncode(publicKey),
    real_pubkey_hex: null,
    real_npub: null,
    source_profile_event_id: null,
    source_profile_relay: null,
    real_account_relays: [],
    copied_profile_event_id: null,
    created_at_ms: Date.now(),
    profile_refreshed_at_ms: null,
  };
  saveIdentity(identity);
  return identity;
}

export function loadIdentity(): LocalIdentityV1 | null {
  const storage = storageOrNull();
  if (!storage) return null;
  const raw = storage.getItem(IDENTITY_STORAGE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!validIdentity(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function getOrCreateIdentity(): LocalIdentityV1 {
  return loadIdentity() ?? createIdentity();
}

export function saveIdentity(identity: LocalIdentityV1): void {
  storageOrNull()?.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  globalThis.dispatchEvent?.(new CustomEvent("sedd-identity-changed", { detail: identity }));
}

export function updateIdentity(update: (identity: LocalIdentityV1) => LocalIdentityV1): LocalIdentityV1 {
  const next = update(getOrCreateIdentity());
  saveIdentity(next);
  return next;
}

export function attachImportedProfile({
  realPubkey,
  realNpub,
  sourceProfileEventId,
  sourceProfileRelay,
  copiedProfileEventId,
  accountRelay,
}: {
  realPubkey: string;
  realNpub: string;
  sourceProfileEventId: string;
  sourceProfileRelay: string;
  copiedProfileEventId: string;
  accountRelay?: string;
}): LocalIdentityV1 {
  return updateIdentity((identity) => ({
    ...identity,
    real_pubkey_hex: realPubkey,
    real_npub: realNpub,
    source_profile_event_id: sourceProfileEventId,
    source_profile_relay: sourceProfileRelay,
    real_account_relays: dedupe([
      ...identity.real_account_relays,
      ...(accountRelay ? [accountRelay] : []),
    ]),
    copied_profile_event_id: copiedProfileEventId,
    profile_refreshed_at_ms: Date.now(),
  }));
}

export function addAccountRelay(relay: string): LocalIdentityV1 {
  return updateIdentity((identity) => ({
    ...identity,
    real_account_relays: dedupe([...identity.real_account_relays, relay]),
  }));
}

export function resetIdentity(): void {
  storageOrNull()?.removeItem(IDENTITY_STORAGE_KEY);
  globalThis.dispatchEvent?.(new CustomEvent("sedd-identity-changed", { detail: null }));
}
