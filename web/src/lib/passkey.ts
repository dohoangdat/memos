import { ForkApiError, forkFetch } from "@/lib/fork-api";
import { combineMemoKey, derivePasskeyMaterial, newPasskeySalt } from "@/lib/memo-crypto";
import { reencryptMemos } from "@/lib/memo-lock";

/**
 * The passkey round trips: the browser stretches the passkey, the server checks the proof (with
 * a rate limit) and releases its share, and the two make the memo key. See lib/memo-crypto.
 */

export type PasskeyRecord = { configured: false } | { configured: true; salt: string; retryAfter: number };

export const getPasskeyRecord = () => forkFetch<PasskeyRecord>("/api/x/passkey");

/** Why the server refused a passkey: wrong (with tries left) or a wait (seconds) still running. */
export interface PasskeyRefusal {
  wrong: boolean;
  attemptsLeft: number;
  retryAfter: number;
}

export const passkeyRefusal = (error: unknown): PasskeyRefusal | null => {
  if (!(error instanceof ForkApiError) || (error.status !== 403 && error.status !== 429)) return null;
  const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return { wrong: error.status === 403, attemptsLeft: number(error.body.attemptsLeft), retryAfter: number(error.body.retryAfter) };
};

const unlockShare = async (passkey: string, salt: string) => {
  const material = await derivePasskeyMaterial(passkey, salt);
  const { share } = await forkFetch<{ share: string }>("/api/x/passkey/unlock", { method: "POST", body: { proof: material.proof } });
  return { material, share, key: await combineMemoKey(material.wrap, share) };
};

/** The memo key for `passkey`; throws a ForkApiError the server refused (see `passkeyRefusal`). */
export const unlockWithPasskey = async (passkey: string, salt: string): Promise<CryptoKey> => (await unlockShare(passkey, salt)).key;

/** Sets up the first passkey and answers its key. */
export async function setupPasskey(passkey: string): Promise<CryptoKey> {
  const salt = newPasskeySalt();
  const material = await derivePasskeyMaterial(passkey, salt);
  const { share } = await forkFetch<{ share: string }>("/api/x/passkey", { method: "PUT", body: { salt, proof: material.proof } });
  return combineMemoKey(material.wrap, share);
}

/**
 * Changes the passkey: proves the current one, re-encrypts the locked memos with the new key,
 * then switches the server over. Should either step fail, the memos go back to the old key so
 * the passkey on record still opens them.
 */
export async function changePasskey(
  current: { passkey: string; salt: string },
  next: string,
  lockedMemoNames: readonly string[],
  onProgress?: (done: number) => void,
): Promise<CryptoKey> {
  const old = await unlockShare(current.passkey, current.salt);
  const salt = newPasskeySalt();
  const material = await derivePasskeyMaterial(next, salt);
  const key = await combineMemoKey(material.wrap, old.share);
  try {
    await reencryptMemos(lockedMemoNames, old.key, key, onProgress);
    await forkFetch("/api/x/passkey", { method: "PUT", body: { salt, proof: material.proof, currentProof: old.material.proof } });
  } catch (error) {
    // Memos already moved to the new key go back; the others still open with the old one.
    await reencryptMemos(lockedMemoNames, key, old.key).catch(() => undefined);
    throw error;
  }
  return key;
}

/** "45 seconds" / "3 minutes", for how long a wait still runs. */
export const formatWait = (seconds: number): string => {
  const minutes = seconds >= 60;
  return new Intl.NumberFormat(undefined, { style: "unit", unit: minutes ? "minute" : "second", unitDisplay: "long" }).format(
    minutes ? Math.ceil(seconds / 60) : Math.max(1, Math.ceil(seconds)),
  );
};
