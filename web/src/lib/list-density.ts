import { useSyncExternalStore } from "react";

/**
 * The memo list's density (fork): cards, or compact two-line rows (title and time, then a
 * short description). A view setting for this device, shared by every list on the page.
 */
const STORAGE_KEY = "memo-list-dense";
const listeners = new Set<() => void>();
const read = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};
let dense = typeof window === "undefined" ? false : read();

export const setDenseList = (value: boolean) => {
  dense = value;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Still applies to this page.
  }
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useDenseList = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => dense,
    () => false,
  );

/** A memo's title and description as plain text: its first line, then the text after it. */
export function memoSummary(content: string): { title: string; description: string } {
  const lines: string[] = [];
  let inCode = false;
  for (const raw of content.split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    const line = raw
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/^\s*(#{1,6}\s+|>\s*|[-*+]\s+\[[ xX]\]\s*|[-*+]\s+|\d+\.\s+)/, "")
      .replace(/[*_~`]/g, "")
      .trim();
    if (line && !/^(#[^\s#]+\s*)+$/.test(line) && !/^-{3,}$/.test(line)) lines.push(line);
  }
  return { title: lines[0] ?? "", description: lines.slice(1).join(" ") };
}
