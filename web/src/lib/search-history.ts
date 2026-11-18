import { useCallback, useEffect, useState } from "react";

/** One past search: what was typed and in which mode. */
export interface SearchHistoryEntry {
  query: string;
  mode: "text" | "cel";
}

/** How many recent searches are kept. */
export const SEARCH_HISTORY_LIMIT = 12;

const storageKey = (owner: string) => `search-history:${owner}`;

const read = (owner: string): SearchHistoryEntry[] => {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(owner)) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter((entry): entry is SearchHistoryEntry => typeof entry?.query === "string" && (entry.mode === "text" || entry.mode === "cel"))
      .slice(0, SEARCH_HISTORY_LIMIT);
  } catch {
    return [];
  }
};

const write = (owner: string, entries: SearchHistoryEntry[]) => {
  try {
    window.localStorage.setItem(storageKey(owner), JSON.stringify(entries));
  } catch {
    // History is a convenience; searching works without it.
  }
};

/** Puts `entry` first, dropping an earlier copy of the same search and the oldest past the limit. */
export const pushSearchHistory = (entries: readonly SearchHistoryEntry[], entry: SearchHistoryEntry): SearchHistoryEntry[] => {
  const query = entry.query.trim();
  if (!query) return [...entries];
  const rest = entries.filter((item) => !(item.mode === entry.mode && item.query === query));
  return [{ query, mode: entry.mode }, ...rest].slice(0, SEARCH_HISTORY_LIMIT);
};

/**
 * The keywords searched recently, newest first, kept on this device per account (`owner`), so
 * one person's searches never show for another signed in on the same browser.
 */
export function useSearchHistory(owner: string) {
  const [entries, setEntries] = useState<SearchHistoryEntry[]>(() => read(owner));
  useEffect(() => setEntries(read(owner)), [owner]);

  const update = useCallback(
    (next: (current: SearchHistoryEntry[]) => SearchHistoryEntry[]) =>
      setEntries((current) => {
        const value = next(current);
        write(owner, value);
        return value;
      }),
    [owner],
  );

  return {
    entries,
    add: useCallback((entry: SearchHistoryEntry) => update((current) => pushSearchHistory(current, entry)), [update]),
    remove: useCallback(
      (entry: SearchHistoryEntry) =>
        update((current) => current.filter((item) => !(item.mode === entry.mode && item.query === entry.query))),
      [update],
    ),
    clear: useCallback(() => update(() => []), [update]),
  };
}
