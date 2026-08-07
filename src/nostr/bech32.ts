const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const CHARSET_MAP = new Map([...CHARSET].map((char, index) => [char, index]));
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < 5; index += 1) {
      if ((top >>> index) & 1) checksum ^= GENERATORS[index] ?? 0;
    }
  }
  return checksum >>> 0;
}

function hrpExpand(hrp: string): number[] {
  return [
    ...[...hrp].map((char) => char.charCodeAt(0) >>> 5),
    0,
    ...[...hrp].map((char) => char.charCodeAt(0) & 31),
  ];
}

function createChecksum(hrp: string, words: number[]): number[] {
  const values = [...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ 1;
  return Array.from({ length: 6 }, (_, index) => (mod >>> (5 * (5 - index))) & 31);
}

function verifyChecksum(hrp: string, words: number[]): boolean {
  return polymod([...hrpExpand(hrp), ...words]) === 1;
}

export function convertBits(
  data: Iterable<number>,
  fromBits: number,
  toBits: number,
  pad: boolean,
): number[] {
  let accumulator = 0;
  let bits = 0;
  const result: number[] = [];
  const maxValue = (1 << toBits) - 1;
  const maxAccumulator = (1 << (fromBits + toBits - 1)) - 1;

  for (const rawValue of data) {
    if (rawValue < 0 || rawValue >>> fromBits !== 0) throw new Error("Invalid bech32 data value");
    accumulator = ((accumulator << fromBits) | rawValue) & maxAccumulator;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >>> bits) & maxValue);
    }
  }

  if (pad) {
    if (bits > 0) result.push((accumulator << (toBits - bits)) & maxValue);
  } else if (bits >= fromBits || ((accumulator << (toBits - bits)) & maxValue) !== 0) {
    throw new Error("Invalid bech32 padding");
  }
  return result;
}

export function bech32Encode(prefix: string, bytes: Uint8Array): string {
  const hrp = prefix.toLowerCase();
  if (!/^[!-~]+$/.test(hrp) || hrp.includes("1")) throw new Error("Invalid bech32 prefix");
  const words = convertBits(bytes, 8, 5, true);
  const checksum = createChecksum(hrp, words);
  const encoded = `${hrp}1${[...words, ...checksum].map((word) => CHARSET[word]).join("")}`;
  if (encoded.length > 5000) throw new Error("Bech32 value is too long");
  return encoded;
}

export function bech32Decode(value: string): { prefix: string; bytes: Uint8Array } {
  if (value.length < 8 || value.length > 5000) throw new Error("Invalid bech32 length");
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) {
    throw new Error("Mixed-case bech32 value");
  }
  const normalized = value.toLowerCase();
  const separator = normalized.lastIndexOf("1");
  if (separator < 1 || separator + 7 > normalized.length) throw new Error("Invalid bech32 separator");
  const prefix = normalized.slice(0, separator);
  const words = [...normalized.slice(separator + 1)].map((char) => {
    const word = CHARSET_MAP.get(char);
    if (word == null) throw new Error("Invalid bech32 character");
    return word;
  });
  if (!verifyChecksum(prefix, words)) throw new Error("Invalid bech32 checksum");
  const payload = words.slice(0, -6);
  return { prefix, bytes: Uint8Array.from(convertBits(payload, 5, 8, false)) };
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error("Invalid hexadecimal value");
  return Uint8Array.from(hex.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []);
}

export function npubEncode(pubkeyHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(pubkeyHex)) throw new Error("Invalid public key");
  return bech32Encode("npub", hexToBytes(pubkeyHex));
}

export function nsecEncode(secretHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(secretHex)) throw new Error("Invalid secret key");
  return bech32Encode("nsec", hexToBytes(secretHex));
}

export function decodeNpub(value: string): string {
  const decoded = bech32Decode(value.trim());
  if (decoded.prefix !== "npub" || decoded.bytes.length !== 32) throw new Error("Expected an npub");
  return bytesToHex(decoded.bytes);
}

export function decodeNsec(value: string): string {
  const decoded = bech32Decode(value.trim());
  if (decoded.prefix !== "nsec" || decoded.bytes.length !== 32) throw new Error("Expected an nsec");
  return bytesToHex(decoded.bytes);
}

function encodeTlv(type: number, value: Uint8Array): Uint8Array {
  if (value.length > 255) throw new Error("TLV value is too long");
  return Uint8Array.from([type, value.length, ...value]);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function naddrEncode({
  identifier,
  pubkey,
  kind,
  relays = [],
}: {
  identifier: string;
  pubkey: string;
  kind: number;
  relays?: string[];
}): string {
  if (!/^[0-9a-f]{64}$/.test(pubkey)) throw new Error("Invalid naddr pubkey");
  const encoder = new TextEncoder();
  const kindBytes = new Uint8Array(4);
  new DataView(kindBytes.buffer).setUint32(0, kind, false);
  const payload = concatBytes([
    encodeTlv(0, encoder.encode(identifier)),
    ...relays.map((relay) => encodeTlv(1, encoder.encode(relay))),
    encodeTlv(2, hexToBytes(pubkey)),
    encodeTlv(3, kindBytes),
  ]);
  return bech32Encode("naddr", payload);
}

export function decodeNaddr(value: string): {
  identifier: string;
  pubkey: string;
  kind: number;
  relays: string[];
} {
  const decoded = bech32Decode(value.trim());
  if (decoded.prefix !== "naddr") throw new Error("Expected an naddr");
  const decoder = new TextDecoder();
  let identifier: string | null = null;
  let pubkey: string | null = null;
  let kind: number | null = null;
  const relays: string[] = [];
  for (let offset = 0; offset < decoded.bytes.length; ) {
    const type = decoded.bytes[offset];
    const length = decoded.bytes[offset + 1];
    if (type == null || length == null || offset + 2 + length > decoded.bytes.length) {
      throw new Error("Invalid naddr TLV");
    }
    const payload = decoded.bytes.slice(offset + 2, offset + 2 + length);
    if (type === 0) identifier = decoder.decode(payload);
    else if (type === 1) relays.push(decoder.decode(payload));
    else if (type === 2 && payload.length === 32) pubkey = bytesToHex(payload);
    else if (type === 3 && payload.length === 4) kind = new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0, false);
    offset += 2 + length;
  }
  if (identifier == null || pubkey == null || kind == null) throw new Error("Incomplete naddr");
  return { identifier, pubkey, kind, relays };
}

export function decodeLnurl(value: string): string {
  const decoded = bech32Decode(value.trim());
  if (decoded.prefix !== "lnurl") throw new Error("Expected an LNURL");
  return new TextDecoder().decode(decoded.bytes);
}

export function encodeLnurl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) {
    throw new Error("LNURL must use HTTPS");
  }
  return bech32Encode("lnurl", new TextEncoder().encode(url.href));
}
