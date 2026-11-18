import { useSyncExternalStore } from "react";

/**
 * "Blur all": a quick privacy switch that shows every memo in lists blurred, title only, until
 * it is switched off. A view setting for this device; it changes no memo.
 */
const STORAGE_KEY = "blur-all-memos";
const listeners = new Set<() => void>();

const read = (): boolean => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

let current = typeof window === "undefined" ? false : read();

export const setBlurAll = (value: boolean) => {
  current = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // The switch still works for this page.
  }
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useBlurAll = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => false,
  );
