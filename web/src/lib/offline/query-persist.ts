import { dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";
import { offlineGet, offlineSet } from "./store";

/**
 * Keeps a copy of the data on screen (memos, tags, settings) in IndexedDB, so the installed app
 * opens with the last memos it showed even without a connection. Restored data is shown as is
 * and refreshed as soon as the server answers.
 */
const QUERIES_KEY = "queries";
/**
 * Copies older than this are dropped: after a week without reaching the server, the app asks to
 * go online (sign in again) instead of showing old data as current.
 */
export const OFFLINE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const MAX_AGE_MS = OFFLINE_MAX_AGE_MS;
const SAVE_DELAY_MS = 2000;

/** Query keys never kept: secrets, and lookups that are only meaningful live. */
const SKIPPED_ROOTS = new Set(["passkey-record", "memo-revisions", "linkMetadata"]);

export async function restoreQueries(queryClient: QueryClient): Promise<void> {
  const saved = await offlineGet<{ at: number; state: unknown }>(QUERIES_KEY);
  if (!saved || Date.now() - saved.at > MAX_AGE_MS) return;
  try {
    hydrate(queryClient, saved.state as Parameters<typeof hydrate>[1]);
  } catch (error) {
    console.warn("Failed to restore the offline copy:", error);
  }
}

export function persistQueries(queryClient: QueryClient): () => void {
  let timer: number | undefined;
  const save = () => {
    timer = undefined;
    const state = dehydrate(queryClient, {
      shouldDehydrateQuery: (query) =>
        query.state.status === "success" && !SKIPPED_ROOTS.has(String(query.queryKey[0])) && !SKIPPED_ROOTS.has(String(query.queryKey[2])),
    });
    void offlineSet(QUERIES_KEY, { at: Date.now(), state });
  };
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" && event.type !== "removed") return;
    if (timer === undefined) timer = window.setTimeout(save, SAVE_DELAY_MS);
  });
  return () => {
    unsubscribe();
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

/** The signed-in identity and its settings, kept so the app can open offline as that user. */
const IDENTITY_KEY = "identity";

export const saveOfflineIdentity = <T>(identity: T) => offlineSet(IDENTITY_KEY, { at: Date.now(), identity });
export const loadOfflineIdentity = async <T>(): Promise<T | undefined> => {
  const saved = await offlineGet<{ at: number; identity: T }>(IDENTITY_KEY);
  return saved && Date.now() - saved.at < MAX_AGE_MS ? saved.identity : undefined;
};

const PROFILE_KEY = "instance-profile";
export const saveOfflineProfile = <T>(profile: T) => offlineSet(PROFILE_KEY, profile);
export const loadOfflineProfile = <T>() => offlineGet<T>(PROFILE_KEY);

/** Whether an error means the server could not be reached (as opposed to a refusal). */
export const isNetworkError = (error: unknown): boolean => {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const text = String((error as { message?: string })?.message ?? error);
  return /failed to fetch|networkerror|network error|load failed|\[unavailable\]|\[unknown\]/i.test(text);
};
