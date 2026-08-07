import { APP_KIND, ZAP_RECEIPT_KIND, ZAP_REQUEST_KIND } from "../config/relays.js";
import type { NostrEvent, ProfileMetadata, ZapReceipt } from "../domain/types.js";
import { getTag, isRecord, isValidHexPubkey } from "../domain/utils.js";
import { decodeLnurl } from "./bech32.js";
import { validateEventShape, verifyEvent } from "./crypto.js";

export interface LnurlPayMetadata {
  callback: string;
  minSendable: number;
  maxSendable: number;
  metadata: string;
  commentAllowed: number;
  allowsNostr: boolean;
  nostrPubkey: string;
  raw: Record<string, unknown>;
}

export interface ZapInvoice {
  invoice: string;
  verifyUrl?: string;
  raw: Record<string, unknown>;
}

export function lightningUrlFromProfile(profile: ProfileMetadata): string | null {
  if (typeof profile.lud16 === "string" && profile.lud16.trim()) {
    const parts = profile.lud16.trim().split("@");
    if (parts.length === 2 && parts[0] && parts[1]) {
      return `https://${parts[1]}/.well-known/lnurlp/${encodeURIComponent(parts[0])}`;
    }
  }
  if (typeof profile.lud06 === "string" && profile.lud06.trim()) {
    try {
      const decoded = decodeLnurl(profile.lud06.trim());
      const url = new URL(decoded);
      if (url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost")) {
        return url.href;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function fetchLnurlPayMetadata(
  profile: ProfileMetadata,
  fetchImpl: typeof fetch = fetch,
): Promise<LnurlPayMetadata> {
  const endpoint = lightningUrlFromProfile(profile);
  if (!endpoint) throw new Error("This presenter has not added a Lightning address to their Nostr profile.");
  const response = await fetchImpl(endpoint, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Lightning address lookup failed (${response.status}).`);
  const value = await response.json() as unknown;
  if (!isRecord(value)) throw new Error("Lightning address returned invalid metadata.");
  if (value.status === "ERROR") throw new Error(typeof value.reason === "string" ? value.reason : "Lightning address rejected the request.");
  if (typeof value.callback !== "string" || typeof value.minSendable !== "number" || typeof value.maxSendable !== "number") {
    throw new Error("Lightning address returned incomplete LNURL-pay metadata.");
  }
  if (value.allowsNostr !== true || !isValidHexPubkey(value.nostrPubkey)) {
    throw new Error("This presenter's Lightning address does not support Nostr zaps.");
  }
  const callback = new URL(value.callback);
  if (callback.protocol !== "https:" && !(callback.protocol === "http:" && callback.hostname === "localhost")) {
    throw new Error("Lightning callback must use HTTPS.");
  }
  return {
    callback: callback.href,
    minSendable: value.minSendable,
    maxSendable: value.maxSendable,
    metadata: typeof value.metadata === "string" ? value.metadata : "[]",
    commentAllowed: typeof value.commentAllowed === "number" ? value.commentAllowed : 0,
    allowsNostr: true,
    nostrPubkey: value.nostrPubkey,
    raw: value,
  };
}

export async function requestZapInvoice({
  metadata,
  amountMsat,
  zapRequest,
  comment,
  fetchImpl = fetch,
}: {
  metadata: LnurlPayMetadata;
  amountMsat: number;
  zapRequest: NostrEvent;
  comment: string;
  fetchImpl?: typeof fetch;
}): Promise<ZapInvoice> {
  if (!Number.isSafeInteger(amountMsat) || amountMsat <= 0) throw new Error("Zap amount must be a positive integer in millisatoshis.");
  if (amountMsat < metadata.minSendable || amountMsat > metadata.maxSendable) {
    throw new Error(`Zap amount must be between ${Math.ceil(metadata.minSendable / 1000)} and ${Math.floor(metadata.maxSendable / 1000)} sats.`);
  }
  const callback = new URL(metadata.callback);
  callback.searchParams.set("amount", String(amountMsat));
  callback.searchParams.set("nostr", JSON.stringify(zapRequest));
  if (comment && metadata.commentAllowed > 0) callback.searchParams.set("comment", comment.slice(0, metadata.commentAllowed));
  const response = await fetchImpl(callback, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Invoice request failed (${response.status}).`);
  const value = await response.json() as unknown;
  if (!isRecord(value)) throw new Error("LNURL callback returned invalid JSON.");
  if (value.status === "ERROR") throw new Error(typeof value.reason === "string" ? value.reason : "Invoice request was rejected.");
  if (typeof value.pr !== "string" || value.pr.length < 20) throw new Error("LNURL callback did not return a Lightning invoice.");
  return {
    invoice: value.pr,
    ...(typeof value.verify === "string" ? { verifyUrl: value.verify } : {}),
    raw: value,
  };
}

export function parseBolt11AmountMsat(invoice: string): number | null {
  const normalized = invoice.trim().toLowerCase();
  const match = /^ln(?:bc|tb|bcrt)(\d+)([munp]?)1/.exec(normalized);
  if (!match?.[1]) return null;
  const amount = BigInt(match[1]);
  const unit = match[2] ?? "";
  const msatPerBtc = 100_000_000_000n;
  let msat: bigint;
  if (unit === "") msat = amount * msatPerBtc;
  else if (unit === "m") msat = amount * 100_000_000n;
  else if (unit === "u") msat = amount * 100_000n;
  else if (unit === "n") msat = amount * 100n;
  else {
    if (amount % 10n !== 0n) return null;
    msat = amount / 10n;
  }
  if (msat > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(msat);
}

export async function parseZapReceipt({
  receipt,
  expectedRecipient,
  expectedAddress,
  servicePubkey,
}: {
  receipt: NostrEvent;
  expectedRecipient?: string;
  expectedAddress?: string;
  servicePubkey?: string;
}): Promise<ZapReceipt | null> {
  if (receipt.kind !== ZAP_RECEIPT_KIND || !(await verifyEvent(receipt))) return null;
  const description = getTag(receipt, "description");
  if (!description) return null;
  let requestValue: unknown;
  try {
    requestValue = JSON.parse(description) as unknown;
  } catch {
    return null;
  }
  if (!validateEventShape(requestValue)) return null;
  const request = requestValue;
  if (request.kind !== ZAP_REQUEST_KIND || !(await verifyEvent(request))) return null;
  const recipient = getTag(request, "p");
  const address = getTag(request, "a");
  const kind = getTag(request, "k");
  if (!isValidHexPubkey(recipient) || !address || kind !== String(APP_KIND)) return null;
  if (expectedRecipient && recipient !== expectedRecipient) return null;
  if (expectedAddress && address !== expectedAddress) return null;
  if (servicePubkey && receipt.pubkey !== servicePubkey) return null;

  const requestedAmountRaw = getTag(request, "amount");
  const requestedAmount = requestedAmountRaw && /^\d+$/.test(requestedAmountRaw) ? Number(requestedAmountRaw) : null;
  const bolt11 = getTag(receipt, "bolt11");
  const invoiceAmount = bolt11 ? parseBolt11AmountMsat(bolt11) : null;
  if (requestedAmount != null && invoiceAmount != null && requestedAmount !== invoiceAmount) return null;
  const amountMsat = invoiceAmount ?? requestedAmount;
  return {
    event: receipt,
    request,
    recipientRealPubkey: recipient,
    targetEntryAddress: address,
    senderPubkey: request.pubkey || null,
    amountMsat,
    amountSats: amountMsat == null ? null : Math.floor(amountMsat / 1000),
    comment: request.content,
    serviceVerified: servicePubkey != null,
  };
}

export async function collectZapReceipts({
  events,
  entries,
  servicePubkeys = new Map<string, string>(),
}: {
  events: NostrEvent[];
  entries: Array<{ address: string; realPubkey: string }>;
  servicePubkeys?: Map<string, string>;
}): Promise<ZapReceipt[]> {
  const targets = new Map(entries.map((entry) => [`${entry.realPubkey}|${entry.address}`, entry]));
  const seen = new Set<string>();
  const results: ZapReceipt[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    const description = getTag(event, "description");
    if (!description) continue;
    let request: unknown;
    try { request = JSON.parse(description) as unknown; } catch { continue; }
    if (!validateEventShape(request)) continue;
    const recipient = getTag(request, "p");
    const address = getTag(request, "a");
    if (!recipient || !address || !targets.has(`${recipient}|${address}`)) continue;
    const servicePubkey = servicePubkeys.get(recipient);
    const parsed = await parseZapReceipt({
      receipt: event,
      expectedRecipient: recipient,
      expectedAddress: address,
      ...(servicePubkey ? { servicePubkey } : {}),
    });
    if (parsed) {
      seen.add(event.id);
      results.push(parsed);
    }
  }
  return results.sort((a, b) => a.event.created_at - b.event.created_at || a.event.id.localeCompare(b.event.id));
}

export function zapTotals(receipts: ZapReceipt[]): { count: number; totalMsat: number; totalSats: number } {
  const totalMsat = receipts.reduce((sum, receipt) => sum + (receipt.amountMsat ?? 0), 0);
  return { count: receipts.length, totalMsat, totalSats: Math.floor(totalMsat / 1000) };
}
