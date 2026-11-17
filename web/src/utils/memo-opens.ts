/**
 * How often each memo was opened full screen, on this device. memos keeps no view counts on the
 * server, so the reader's "opens" and the sidebar's Most opened view read them from here.
 */
const OPENS_KEY = "memos-open-counts";

export const readMemoOpens = (): Record<string, number> => {
  try {
    const value = JSON.parse(localStorage.getItem(OPENS_KEY) ?? "{}") as unknown;
    return value && typeof value === "object" ? (value as Record<string, number>) : {};
  } catch {
    return {};
  }
};

/** Counts one more open of a memo (by resource name) and returns the new count. */
export const countMemoOpen = (memoName: string): number => {
  const opens = readMemoOpens();
  opens[memoName] = (opens[memoName] ?? 0) + 1;
  try {
    localStorage.setItem(OPENS_KEY, JSON.stringify(opens));
  } catch {
    // Private mode or full storage: the count for this visit still shows.
  }
  return opens[memoName];
};

/** The uids of the most opened memos, most opened first. */
export const topOpenedMemoUids = (limit = 20): string[] =>
  Object.entries(readMemoOpens())
    .filter(([, count]) => count > 0)
    .sort(([, left], [, right]) => right - left)
    .slice(0, limit)
    .map(([name]) => name.split("/").pop() ?? "")
    .filter(Boolean);
