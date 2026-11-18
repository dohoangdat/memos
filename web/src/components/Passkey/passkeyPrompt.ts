import { getSessionKey } from "@/lib/memo-crypto";

type Pending = { resolve: (key: CryptoKey | null) => void; reason?: string };

let pending: Pending | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export const getPendingPasskeyRequest = () => pending;
export const subscribePasskeyRequest = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Asks for the passkey (PasskeyPromptHost shows the dialog); resolves the key, or null if dismissed. */
export function requestPasskey(reason?: string): Promise<CryptoKey | null> {
  pending?.resolve(null);
  return new Promise((resolve) => {
    pending = { resolve, reason };
    notify();
  });
}

export function settlePasskeyRequest(key: CryptoKey | null) {
  const current = pending;
  pending = null;
  notify();
  current?.resolve(key);
}

/** The unlocked key, asking for the passkey first when this tab is still locked. */
export const ensurePasskey = (reason?: string): Promise<CryptoKey | null> => {
  const key = getSessionKey();
  return key ? Promise.resolve(key) : requestPasskey(reason);
};
