import { useQuery } from "@tanstack/react-query";
import { getRequestToken } from "@/connect";

export const starredMemoKeys = { uids: ["starred-memo-uids"] as const };

/** The uids of the memos the current user starred (their ⭐ reaction), from the fork's endpoint. */
export function useStarredMemoUids(enabled: boolean) {
  return useQuery({
    queryKey: starredMemoKeys.uids,
    enabled,
    staleTime: 0,
    queryFn: async (): Promise<string[]> => {
      const token = await getRequestToken();
      const response = await fetch("/api/x/memos/starred", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: "include",
      });
      if (!response.ok) throw new Error(`Failed to load starred memos (HTTP ${response.status})`);
      return ((await response.json()) as { uids?: string[] }).uids ?? [];
    },
  });
}
