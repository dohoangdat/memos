/**
 * Passkey encryption for locked memos, done entirely in the browser. The passkey never leaves
 * the device, and the server cannot read a locked memo.
 *
 * - The passkey is stretched with PBKDF2-SHA256 (600,000 rounds, the user's random salt) into
 *   two halves: a `proof` the server checks, and a `wrap` half that never leaves the browser.
 * - The server checks the proof with a rate limit (server/protection) and only then hands over
 *   the user's random `share`. The memo key is HKDF(wrap ‖ share): guessing passkeys needs the
 *   share, so every guess goes through the rate-limited server. Nothing the browser holds before
 *   unlocking (salt, ciphertext) lets anyone test passkeys offline.
 * - Locked memo: the `# Title` line and the memo's `#tags` stay readable (lists show the title;
 *   the server indexes the tags), everything is encrypted into a ```memos-lock block.
 *
 * Someone holding the whole database (proof hash and share) can still try the million passkeys
 * offline; the rate limit protects against guessing through the app.
 */

export const PASSKEY_PATTERN = /^\d{6}$/;
const PBKDF2_ROUNDS = 600_000;
const HKDF_INFO = "memos-lock:v2";
const LOCK_FENCE = "memos-lock";
const LOCK_BLOCK = new RegExp("```" + LOCK_FENCE + "\\n([A-Za-z0-9+/=_-]+)\\n```");

const subtle = () => {
  const value = globalThis.crypto?.subtle;
  if (!value) throw new Error("Encryption needs a secure (https) page");
  return value;
};

/** Base64 in chunks: spreading a large array into one call overflows the stack on big memos. */
const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};
const fromBase64 = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const randomBytes = (length: number) => globalThis.crypto.getRandomValues(new Uint8Array(length));

/** A fresh random salt for a new passkey. */
export const newPasskeySalt = () => toBase64(randomBytes(16));

export interface PasskeyMaterial {
  /** Sent to the server, which compares its hash. */
  proof: string;
  /** Stays in the browser; combined with the server's share into the memo key. */
  wrap: Uint8Array<ArrayBuffer>;
}

/** Stretches the passkey into the proof for the server and the half that stays here. */
export async function derivePasskeyMaterial(passkey: string, salt: string): Promise<PasskeyMaterial> {
  if (!PASSKEY_PATTERN.test(passkey)) throw new Error("The passkey is 6 digits");
  const material = await subtle().importKey("raw", new TextEncoder().encode(passkey), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(
    await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromBase64(salt), iterations: PBKDF2_ROUNDS }, material, 512),
  );
  return { proof: toBase64(bits.slice(0, 32)), wrap: bits.slice(32) };
}

/** The memo key from the browser's half and the share the server released. */
export async function combineMemoKey(wrap: Uint8Array<ArrayBuffer>, share: string): Promise<CryptoKey> {
  const shareBytes = fromBase64(share);
  const input = new Uint8Array(wrap.length + shareBytes.length);
  input.set(wrap);
  input.set(shareBytes, wrap.length);
  const base = await subtle().importKey("raw", input, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(HKDF_INFO) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const encrypt = async (key: CryptoKey, text: string) => {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)));
  return { iv: toBase64(iv), ct: toBase64(ct) };
};

const decrypt = async (key: CryptoKey, iv: string, ct: string) =>
  new TextDecoder().decode(await subtle().decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, key, fromBase64(ct)));

/** The `# Title` line a locked memo keeps readable, if the memo starts with one. */
export const memoTitle = (content: string): string => {
  const first = content.trimStart().split("\n", 1)[0] ?? "";
  return /^#\s+\S/.test(first) ? first.trim() : "";
};

export const isLockedContent = (content: string): boolean => LOCK_BLOCK.test(content);

/** The title of a memo's content, readable whether or not it is locked. */
export const lockedTitle = (content: string): string => memoTitle(content);

/** Fenced and inline code: `#words` there are not tags. */
const stripCode = (content: string) => content.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\S\n]*$/gm, "").replace(/`[^`\n]*`/g, "");

/**
 * The `#tags` a memo's text holds, in order and without repeats, so that a locked memo keeps them
 * readable. A close match of the server's rules; the server parses the tag line again itself.
 */
export function memoTags(content: string): string[] {
  const tags = new Set<string>();
  for (const match of stripCode(content).matchAll(/(?<=^|\s)#([\p{L}\p{N}\p{M}_&+-]+(?:\/[\p{L}\p{N}\p{M}_&+-]+)*)/gmu)) {
    tags.add(match[1]);
  }
  // `#a/b` already stands for `#a`.
  return [...tags].filter((tag) => ![...tags].some((other) => other.startsWith(`${tag}/`)));
}

/** The readable tags of a locked memo's content (the line next to the lock). */
export const lockedTags = (content: string): string[] => {
  const line = content.split("\n").find((value) => value.startsWith("🔒"));
  return line ? memoTags(line) : [];
};

export async function encryptMemoContent(content: string, key: CryptoKey): Promise<string> {
  const { iv, ct } = await encrypt(key, JSON.stringify({ v: 1, content }));
  const payload = toBase64(new TextEncoder().encode(JSON.stringify({ v: 1, iv, ct })));
  const title = memoTitle(content);
  const tags = memoTags(content.slice(title ? content.indexOf(title) + title.length : 0));
  const lockLine = ["🔒", ...tags.map((tag) => `#${tag}`)].join(" ");
  return `${title ? `${title}\n\n` : ""}${lockLine}\n\n\`\`\`${LOCK_FENCE}\n${payload}\n\`\`\``;
}

/** The plaintext of a locked memo's content; throws when the key does not fit. */
export async function decryptMemoContent(content: string, key: CryptoKey): Promise<string> {
  const match = content.match(LOCK_BLOCK);
  if (!match) return content;
  const { iv, ct } = JSON.parse(new TextDecoder().decode(fromBase64(match[1]))) as { iv: string; ct: string };
  return (JSON.parse(await decrypt(key, iv, ct)) as { content: string }).content;
}

// ---------------------------------------------------------------------------
// The unlocked key for this tab. Memory only: reloading the page locks every memo again.

let sessionKey: CryptoKey | null = null;
const listeners = new Set<() => void>();

export const getSessionKey = () => sessionKey;
export const setSessionKey = (key: CryptoKey | null) => {
  sessionKey = key;
  for (const listener of listeners) listener();
};
export const subscribeSessionKey = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
