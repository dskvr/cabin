import type { NostrEvent, UnsignedNostrEvent } from "../domain/types.js";
import { bytesToHex, hexToBytes } from "./bech32.js";

const FIELD = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

interface JacobianPoint {
  x: bigint;
  y: bigint;
  z: bigint;
}

interface AffinePoint {
  x: bigint;
  y: bigint;
}

const INFINITY: JacobianPoint = { x: 0n, y: 1n, z: 0n };
const GENERATOR: JacobianPoint = { x: GX, y: GY, z: 1n };
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const NIP44_SALT = encoder.encode("nip44-v2");
const NIP44_VERSION = 2;
const NIP44_MAX_PLAINTEXT_BYTES = 32_768;
const NIP44_MAX_PAYLOAD_CHARS = 65_536;
const SHA256_INITIAL = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);
const SHA256_ROUND = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function mod(value: bigint, modulus = FIELD): bigint {
  const result = value % modulus;
  return result >= 0n ? result : result + modulus;
}

function powMod(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let factor = mod(base, modulus);
  let power = exponent;
  while (power > 0n) {
    if (power & 1n) result = (result * factor) % modulus;
    factor = (factor * factor) % modulus;
    power >>= 1n;
  }
  return result;
}

function inverse(value: bigint): bigint {
  if (value === 0n) throw new Error("Cannot invert zero");
  return powMod(value, FIELD - 2n, FIELD);
}

function isInfinity(point: JacobianPoint): boolean {
  return point.z === 0n;
}

function pointDouble(point: JacobianPoint): JacobianPoint {
  if (isInfinity(point) || point.y === 0n) return INFINITY;
  const a = mod(point.x * point.x);
  const b = mod(point.y * point.y);
  const c = mod(b * b);
  const d = mod(2n * (mod((point.x + b) * (point.x + b)) - a - c));
  const e = mod(3n * a);
  const f = mod(e * e);
  const x = mod(f - 2n * d);
  const y = mod(e * (d - x) - 8n * c);
  const z = mod(2n * point.y * point.z);
  return { x, y, z };
}

function pointAdd(left: JacobianPoint, right: JacobianPoint): JacobianPoint {
  if (isInfinity(left)) return right;
  if (isInfinity(right)) return left;

  const z1z1 = mod(left.z * left.z);
  const z2z2 = mod(right.z * right.z);
  const u1 = mod(left.x * z2z2);
  const u2 = mod(right.x * z1z1);
  const s1 = mod(left.y * right.z * z2z2);
  const s2 = mod(right.y * left.z * z1z1);
  const h = mod(u2 - u1);
  const r = mod(s2 - s1);

  if (h === 0n) return r === 0n ? pointDouble(left) : INFINITY;

  const hh = mod(h * h);
  const hhh = mod(h * hh);
  const v = mod(u1 * hh);
  const x = mod(r * r - hhh - 2n * v);
  const y = mod(r * (v - x) - s1 * hhh);
  const z = mod(h * left.z * right.z);
  return { x, y, z };
}

function pointNegate(point: JacobianPoint): JacobianPoint {
  return isInfinity(point) ? point : { x: point.x, y: mod(-point.y), z: point.z };
}

function scalarMultiply(scalar: bigint, point: JacobianPoint = GENERATOR): JacobianPoint {
  let value = mod(scalar, ORDER);
  if (value === 0n || isInfinity(point)) return INFINITY;
  let result = INFINITY;
  let addend = point;
  while (value > 0n) {
    if (value & 1n) result = pointAdd(result, addend);
    addend = pointDouble(addend);
    value >>= 1n;
  }
  return result;
}

function toAffine(point: JacobianPoint): AffinePoint {
  if (isInfinity(point)) throw new Error("Point at infinity");
  const zInv = inverse(point.z);
  const z2 = mod(zInv * zInv);
  const x = mod(point.x * z2);
  const y = mod(point.y * z2 * zInv);
  return { x, y };
}

function liftX(x: bigint): JacobianPoint | null {
  if (x >= FIELD) return null;
  const ySquared = mod(x * x * x + 7n);
  let y = powMod(ySquared, (FIELD + 1n) / 4n, FIELD);
  if (mod(y * y) !== ySquared) return null;
  if (y & 1n) y = FIELD - y;
  return { x, y, z: 1n };
}

function bigintToBytes(value: bigint, length = 32): Uint8Array {
  const hex = value.toString(16).padStart(length * 2, "0");
  if (hex.length > length * 2) throw new Error("Integer does not fit in byte array");
  return hexToBytes(hex);
}

function bytesToBigint(bytes: Uint8Array): bigint {
  return BigInt(`0x${bytesToHex(bytes) || "0"}`);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return globalThis.btoa(binary);
}

function base64Decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) throw new Error("Invalid NIP-44 base64 payload");
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const blockKey = key.length > 64 ? await sha256(key) : key;
  const normalized = new Uint8Array(64);
  normalized.set(blockKey);
  const inner = Uint8Array.from(normalized, (value) => value ^ 0x36);
  const outer = Uint8Array.from(normalized, (value) => value ^ 0x5c);
  return sha256(concatBytes(outer, await sha256(concatBytes(inner, message))));
}

async function hkdfExtract(ikm: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  return hmacSha256(salt, ikm);
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  if (length < 1 || length > 255 * 32) throw new Error("Invalid HKDF output length");
  const blocks: Uint8Array[] = [];
  let previous = new Uint8Array();
  for (let index = 1; blocks.length * 32 < length; index += 1) {
    previous = await hmacSha256(prk, concatBytes(previous, info, Uint8Array.of(index)));
    blocks.push(previous);
  }
  return concatBytes(...blocks).slice(0, length);
}

function rotateLeft(value: number, shift: number): number {
  return (value << shift) | (value >>> (32 - shift));
}

function quarterRound(state: Uint32Array, a: number, b: number, c: number, d: number): void {
  state[a] = ((state[a] ?? 0) + (state[b] ?? 0)) >>> 0; state[d] = rotateLeft((state[d] ?? 0) ^ (state[a] ?? 0), 16) >>> 0;
  state[c] = ((state[c] ?? 0) + (state[d] ?? 0)) >>> 0; state[b] = rotateLeft((state[b] ?? 0) ^ (state[c] ?? 0), 12) >>> 0;
  state[a] = ((state[a] ?? 0) + (state[b] ?? 0)) >>> 0; state[d] = rotateLeft((state[d] ?? 0) ^ (state[a] ?? 0), 8) >>> 0;
  state[c] = ((state[c] ?? 0) + (state[d] ?? 0)) >>> 0; state[b] = rotateLeft((state[b] ?? 0) ^ (state[c] ?? 0), 7) >>> 0;
}

function chacha20(key: Uint8Array, nonce: Uint8Array, input: Uint8Array): Uint8Array {
  if (key.length !== 32 || nonce.length !== 12) throw new Error("Invalid ChaCha20 key or nonce");
  const keyView = new DataView(key.buffer, key.byteOffset, key.byteLength);
  const nonceView = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
  const output = new Uint8Array(input.length);
  for (let offset = 0, counter = 0; offset < input.length; offset += 64, counter += 1) {
    if (counter > 0xffff_ffff) throw new Error("NIP-44 payload is too large");
    const initial = new Uint32Array([
      0x61707865, 0x3320646e, 0x79622d32, 0x6b206574,
      ...Array.from({ length: 8 }, (_, index) => keyView.getUint32(index * 4, true)),
      counter,
      nonceView.getUint32(0, true), nonceView.getUint32(4, true), nonceView.getUint32(8, true),
    ]);
    const working = new Uint32Array(initial);
    for (let round = 0; round < 10; round += 1) {
      quarterRound(working, 0, 4, 8, 12); quarterRound(working, 1, 5, 9, 13); quarterRound(working, 2, 6, 10, 14); quarterRound(working, 3, 7, 11, 15);
      quarterRound(working, 0, 5, 10, 15); quarterRound(working, 1, 6, 11, 12); quarterRound(working, 2, 7, 8, 13); quarterRound(working, 3, 4, 9, 14);
    }
    const stream = new Uint8Array(64);
    const streamView = new DataView(stream.buffer);
    for (let index = 0; index < 16; index += 1) streamView.setUint32(index * 4, ((working[index] ?? 0) + (initial[index] ?? 0)) >>> 0, true);
    const size = Math.min(64, input.length - offset);
    for (let index = 0; index < size; index += 1) output[offset + index] = (input[offset + index] ?? 0) ^ (stream[index] ?? 0);
  }
  return output;
}

export function nip44PaddedLength(length: number): number {
  if (!Number.isSafeInteger(length) || length < 1) throw new Error("Invalid NIP-44 plaintext length");
  if (length <= 32) return 32;
  const nextPower = 2 ** (Math.floor(Math.log2(length - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((length - 1) / chunk) + 1);
}

function nip44Pad(plaintext: string): Uint8Array {
  const unpadded = encoder.encode(plaintext);
  if (unpadded.length < 1 || unpadded.length > NIP44_MAX_PLAINTEXT_BYTES) throw new Error("Invalid NIP-44 plaintext length");
  const prefixLength = unpadded.length < 65_536 ? 2 : 6;
  const result = new Uint8Array(prefixLength + nip44PaddedLength(unpadded.length));
  const view = new DataView(result.buffer);
  if (prefixLength === 2) view.setUint16(0, unpadded.length); else view.setUint32(2, unpadded.length);
  result.set(unpadded, prefixLength);
  return result;
}

function nip44Unpad(padded: Uint8Array): string {
  if (padded.length < 34) throw new Error("Invalid NIP-44 padding");
  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  const compactLength = view.getUint16(0);
  const prefixLength = compactLength === 0 ? 6 : 2;
  const length = compactLength === 0 ? view.getUint32(2) : compactLength;
  if (length < 1 || length > NIP44_MAX_PLAINTEXT_BYTES || (prefixLength === 6 && length < 65_536)) throw new Error("Invalid NIP-44 padding");
  if (padded.length !== prefixLength + nip44PaddedLength(length)) throw new Error("Invalid NIP-44 padding");
  return decoder.decode(padded.slice(prefixLength, prefixLength + length));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

async function nip44ConversationKey(secretKeyHex: string, publicKeyHex: string): Promise<Uint8Array> {
  const secretBytes = hexToBytes(secretKeyHex);
  const publicBytes = hexToBytes(publicKeyHex);
  if (secretBytes.length !== 32 || publicBytes.length !== 32) throw new Error("Invalid NIP-44 key");
  const secret = bytesToBigint(secretBytes);
  const publicPoint = liftX(bytesToBigint(publicBytes));
  if (secret <= 0n || secret >= ORDER || !publicPoint) throw new Error("Invalid NIP-44 key");
  const shared = toAffine(scalarMultiply(secret, publicPoint));
  return hkdfExtract(bigintToBytes(shared.x), NIP44_SALT);
}

async function nip44MessageKeys(conversationKey: Uint8Array, nonce: Uint8Array): Promise<{
  chachaKey: Uint8Array;
  chachaNonce: Uint8Array;
  hmacKey: Uint8Array;
}> {
  if (conversationKey.length !== 32 || nonce.length !== 32) throw new Error("Invalid NIP-44 key material");
  const expanded = await hkdfExpand(conversationKey, nonce, 76);
  return {
    chachaKey: expanded.slice(0, 32),
    chachaNonce: expanded.slice(32, 44),
    hmacKey: expanded.slice(44, 76),
  };
}

/** Encrypt a NIP-44 v2 payload. An explicit nonce is accepted only for test vectors. */
export async function nip44Encrypt(
  plaintext: string,
  secretKeyHex: string,
  recipientPublicKeyHex: string,
  nonce = globalThis.crypto.getRandomValues(new Uint8Array(32)),
): Promise<string> {
  if (nonce.length !== 32) throw new Error("Invalid NIP-44 nonce");
  const padded = nip44Pad(plaintext);
  const keys = await nip44MessageKeys(await nip44ConversationKey(secretKeyHex, recipientPublicKeyHex), nonce);
  const ciphertext = chacha20(keys.chachaKey, keys.chachaNonce, padded);
  const mac = await hmacSha256(keys.hmacKey, concatBytes(nonce, ciphertext));
  return base64Encode(concatBytes(Uint8Array.of(NIP44_VERSION), nonce, ciphertext, mac));
}

/** Authenticate and decrypt a bounded NIP-44 v2 payload. */
export async function nip44Decrypt(
  payload: string,
  secretKeyHex: string,
  senderPublicKeyHex: string,
): Promise<string> {
  if (payload.length < 132 || payload.length > NIP44_MAX_PAYLOAD_CHARS) throw new Error("Invalid NIP-44 payload length");
  const decoded = base64Decode(payload);
  if (decoded.length < 99 || decoded[0] !== NIP44_VERSION) throw new Error("Invalid NIP-44 payload");
  const nonce = decoded.slice(1, 33);
  const ciphertext = decoded.slice(33, -32);
  const suppliedMac = decoded.slice(-32);
  const keys = await nip44MessageKeys(await nip44ConversationKey(secretKeyHex, senderPublicKeyHex), nonce);
  const expectedMac = await hmacSha256(keys.hmacKey, concatBytes(nonce, ciphertext));
  if (!constantTimeEqual(suppliedMac, expectedMac)) throw new Error("Invalid NIP-44 authentication code");
  return nip44Unpad(chacha20(keys.chachaKey, keys.chachaNonce, ciphertext));
}

export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? encoder.encode(data) : data;
  const subtle = globalThis.crypto?.subtle;
  if (subtle) return new Uint8Array(await subtle.digest("SHA-256", bytes));
  return sha256Fallback(bytes);
}

function rotateRight(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

function sha256Fallback(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = new Uint32Array(SHA256_INITIAL);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15] ?? 0;
      const previous2 = words[index - 2] ?? 0;
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e ?? 0, 6) ^ rotateRight(e ?? 0, 11) ^ rotateRight(e ?? 0, 25);
      const choice = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const temp1 = (h ?? 0) + sum1 + choice + (SHA256_ROUND[index] ?? 0) + (words[index] ?? 0);
      const sum0 = rotateRight(a ?? 0, 2) ^ rotateRight(a ?? 0, 13) ^ rotateRight(a ?? 0, 22);
      const majority = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0));
      const temp2 = sum0 + majority;
      h = g; g = f; f = e; e = ((d ?? 0) + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] ?? 0) + (a ?? 0);
    hash[1] = (hash[1] ?? 0) + (b ?? 0);
    hash[2] = (hash[2] ?? 0) + (c ?? 0);
    hash[3] = (hash[3] ?? 0) + (d ?? 0);
    hash[4] = (hash[4] ?? 0) + (e ?? 0);
    hash[5] = (hash[5] ?? 0) + (f ?? 0);
    hash[6] = (hash[6] ?? 0) + (g ?? 0);
    hash[7] = (hash[7] ?? 0) + (h ?? 0);
  }

  const result = new Uint8Array(32);
  const resultView = new DataView(result.buffer);
  hash.forEach((value, index) => resultView.setUint32(index * 4, value));
  return result;
}

async function taggedHash(tag: string, message: Uint8Array): Promise<Uint8Array> {
  const tagHash = await sha256(tag);
  return sha256(concatBytes(tagHash, tagHash, message));
}

function xorBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.length !== right.length) throw new Error("XOR length mismatch");
  return Uint8Array.from(left, (value, index) => value ^ (right[index] ?? 0));
}

export function generateSecretKeyHex(): string {
  for (;;) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const scalar = bytesToBigint(bytes);
    if (scalar > 0n && scalar < ORDER) return bytesToHex(bytes);
  }
}

export function getPublicKey(secretKeyHex: string): string {
  const scalar = bytesToBigint(hexToBytes(secretKeyHex));
  if (scalar <= 0n || scalar >= ORDER) throw new Error("Invalid secret key");
  return toAffine(scalarMultiply(scalar)).x.toString(16).padStart(64, "0");
}

export async function schnorrSign(messageHash: Uint8Array, secretKeyHex: string): Promise<string> {
  if (messageHash.length !== 32) throw new Error("Schnorr messages must be 32 bytes");
  const initialSecret = bytesToBigint(hexToBytes(secretKeyHex));
  if (initialSecret <= 0n || initialSecret >= ORDER) throw new Error("Invalid secret key");
  const publicPoint = toAffine(scalarMultiply(initialSecret));
  const secret = publicPoint.y & 1n ? ORDER - initialSecret : initialSecret;
  const publicX = bigintToBytes(publicPoint.x);
  const aux = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const t = xorBytes(bigintToBytes(secret), await taggedHash("BIP0340/aux", aux));
  const nonceHash = await taggedHash("BIP0340/nonce", concatBytes(t, publicX, messageHash));
  const nonce0 = bytesToBigint(nonceHash) % ORDER;
  if (nonce0 === 0n) throw new Error("Invalid Schnorr nonce");
  const noncePoint = toAffine(scalarMultiply(nonce0));
  const nonce = noncePoint.y & 1n ? ORDER - nonce0 : nonce0;
  const challengeHash = await taggedHash(
    "BIP0340/challenge",
    concatBytes(bigintToBytes(noncePoint.x), publicX, messageHash),
  );
  const challenge = bytesToBigint(challengeHash) % ORDER;
  const s = mod(nonce + challenge * secret, ORDER);
  const signature = concatBytes(bigintToBytes(noncePoint.x), bigintToBytes(s));
  if (!(await schnorrVerify(signature, messageHash, publicX))) {
    throw new Error("Internal Schnorr signature verification failed");
  }
  return bytesToHex(signature);
}

export async function schnorrVerify(
  signature: Uint8Array | string,
  messageHash: Uint8Array,
  publicKey: Uint8Array | string,
): Promise<boolean> {
  try {
    const sig = typeof signature === "string" ? hexToBytes(signature) : signature;
    const pub = typeof publicKey === "string" ? hexToBytes(publicKey) : publicKey;
    if (sig.length !== 64 || messageHash.length !== 32 || pub.length !== 32) return false;
    const r = bytesToBigint(sig.slice(0, 32));
    const s = bytesToBigint(sig.slice(32));
    const publicX = bytesToBigint(pub);
    if (r >= FIELD || s >= ORDER || publicX >= FIELD) return false;
    const point = liftX(publicX);
    if (!point) return false;
    const challengeHash = await taggedHash(
      "BIP0340/challenge",
      concatBytes(bigintToBytes(r), pub, messageHash),
    );
    const challenge = bytesToBigint(challengeHash) % ORDER;
    const result = pointAdd(scalarMultiply(s), pointNegate(scalarMultiply(challenge, point)));
    if (isInfinity(result)) return false;
    const affine = toAffine(result);
    return (affine.y & 1n) === 0n && affine.x === r;
  } catch {
    return false;
  }
}

export function serializeEvent(event: Pick<NostrEvent, "pubkey" | "created_at" | "kind" | "tags" | "content">): string {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
}

export async function getEventHash(
  event: Pick<NostrEvent, "pubkey" | "created_at" | "kind" | "tags" | "content">,
): Promise<string> {
  return bytesToHex(await sha256(serializeEvent(event)));
}

export async function finalizeEvent(
  template: UnsignedNostrEvent,
  secretKeyHex: string,
): Promise<NostrEvent> {
  const pubkey = getPublicKey(secretKeyHex);
  const event = {
    kind: template.kind,
    created_at: template.created_at,
    tags: template.tags.map((tag) => [...tag]),
    content: template.content,
    pubkey,
  };
  const id = await getEventHash(event);
  const sig = await schnorrSign(hexToBytes(id), secretKeyHex);
  return { ...event, id, sig };
}

function isStringArrayArray(value: unknown): value is string[][] {
  return Array.isArray(value) && value.every(
    (tag) => Array.isArray(tag) && tag.every((item) => typeof item === "string"),
  );
}

export function validateEventShape(value: unknown): value is NostrEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Partial<NostrEvent>;
  return (
    typeof event.id === "string" && /^[0-9a-f]{64}$/.test(event.id) &&
    typeof event.pubkey === "string" && /^[0-9a-f]{64}$/.test(event.pubkey) &&
    typeof event.created_at === "number" && Number.isSafeInteger(event.created_at) && event.created_at >= 0 &&
    typeof event.kind === "number" && Number.isSafeInteger(event.kind) && event.kind >= 0 &&
    isStringArrayArray(event.tags) &&
    typeof event.content === "string" &&
    typeof event.sig === "string" && /^[0-9a-f]{128}$/.test(event.sig)
  );
}

export async function verifyEvent(event: NostrEvent): Promise<boolean> {
  if (!validateEventShape(event)) return false;
  const expectedId = await getEventHash(event);
  if (expectedId !== event.id) return false;
  return schnorrVerify(event.sig, hexToBytes(event.id), event.pubkey);
}
