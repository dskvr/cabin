import type { NostrEvent, UnsignedNostrEvent } from "../domain/types.js";
import { finalizeEvent, getPublicKey, nip44Decrypt, verifyEvent } from "./crypto.js";

const NIP07_PUBKEY_STORAGE_KEY = "captains-cabin.nip07-pubkey";

export interface EventSigner {
  readonly publicKey: string;
  readonly kind: "local" | "nip07";
  signEvent(template: UnsignedNostrEvent): Promise<NostrEvent>;
  decryptNip44(senderPublicKey: string, ciphertext: string): Promise<string>;
}

interface BrowserNostr {
  getPublicKey(): Promise<string>;
  signEvent(template: UnsignedNostrEvent): Promise<NostrEvent>;
  nip44?: {
    decrypt(publicKey: string, ciphertext: string): Promise<string>;
  };
}

declare global {
  interface Window {
    nostr?: BrowserNostr;
  }
}

function isPublicKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function extension(): BrowserNostr {
  const nostr = globalThis.window?.nostr;
  if (!nostr) throw new Error("No NIP-07 browser extension was detected");
  return nostr;
}

export function hasNip07(): boolean {
  return Boolean(globalThis.window?.nostr);
}

export function rememberedNip07PublicKey(): string | null {
  try {
    const value = globalThis.localStorage.getItem(NIP07_PUBKEY_STORAGE_KEY);
    return isPublicKey(value) ? value : null;
  } catch {
    return null;
  }
}

export function forgetNip07(): void {
  try { globalThis.localStorage.removeItem(NIP07_PUBKEY_STORAGE_KEY); } catch { /* Session state still clears. */ }
}

export async function connectNip07(): Promise<Nip07Signer> {
  const publicKey = (await extension().getPublicKey()).toLowerCase();
  if (!isPublicKey(publicKey)) throw new Error("The NIP-07 extension returned an invalid public key");
  try { globalThis.localStorage.setItem(NIP07_PUBKEY_STORAGE_KEY, publicKey); } catch { /* Connection remains active for this page. */ }
  return new Nip07Signer(publicKey);
}

export function localSigner(secretKeyHex: string): EventSigner {
  const publicKey = getPublicKey(secretKeyHex);
  return {
    publicKey,
    kind: "local",
    signEvent: (template) => finalizeEvent(template, secretKeyHex),
    decryptNip44: (senderPublicKey, ciphertext) => nip44Decrypt(ciphertext, secretKeyHex, senderPublicKey),
  };
}

export class Nip07Signer implements EventSigner {
  readonly publicKey: string;
  readonly kind = "nip07" as const;

  constructor(publicKey: string) {
    if (!isPublicKey(publicKey)) throw new Error("Invalid NIP-07 public key");
    this.publicKey = publicKey;
  }

  async signEvent(template: UnsignedNostrEvent): Promise<NostrEvent> {
    const signed = await extension().signEvent({
      kind: template.kind,
      created_at: template.created_at,
      tags: template.tags.map((tag) => [...tag]),
      content: template.content,
    });
    if (signed.pubkey !== this.publicKey || signed.kind !== template.kind || signed.created_at !== template.created_at || signed.content !== template.content || JSON.stringify(signed.tags) !== JSON.stringify(template.tags) || !(await verifyEvent(signed))) {
      throw new Error("The NIP-07 extension returned an invalid or altered event");
    }
    return signed;
  }

  async decryptNip44(senderPublicKey: string, ciphertext: string): Promise<string> {
    const nip44 = extension().nip44;
    if (!nip44) throw new Error("This NIP-07 extension does not provide NIP-44 decryption");
    return nip44.decrypt(senderPublicKey, ciphertext);
  }
}
