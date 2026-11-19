import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import useCurrentUser from "@/hooks/useCurrentUser";
import { forkFetch } from "@/lib/fork-api";

export const tagOrderKeys = { all: ["tag-order"] as const };

/** The user's own order of tags (full paths), set in tag management; [] until they set one. */
export function useTagOrder() {
  const currentUser = useCurrentUser();
  return useQuery({
    queryKey: tagOrderKeys.all,
    enabled: Boolean(currentUser),
    staleTime: 5 * 60_000,
    queryFn: async () => (await forkFetch<{ tags: string[] }>("/api/x/tag-order")).tags,
  });
}

export function useSaveTagOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tags: string[]) => (await forkFetch<{ tags: string[] }>("/api/x/tag-order", { method: "PUT", body: { tags } })).tags,
    onMutate: (tags) => queryClient.setQueryData(tagOrderKeys.all, tags),
    onSettled: () => queryClient.invalidateQueries({ queryKey: tagOrderKeys.all }),
  });
}

/**
 * Sorts tags by `order`: listed tags first in that order; the others after, most used first,
 * then by name. A tag the order does not list follows its parent's place in the tree.
 */
export const orderTags = (tagCounts: Record<string, number>, order: readonly string[]): [string, number][] => {
  const rank = new Map(order.map((tag, index) => [tag, index]));
  const rankOf = (tag: string) => rank.get(tag) ?? Number.POSITIVE_INFINITY;
  return Object.entries(tagCounts).sort(([a, countA], [b, countB]) => {
    const byRank = rankOf(a) - rankOf(b);
    if (byRank !== 0 && Number.isFinite(byRank)) return byRank;
    if (Number.isFinite(rankOf(a)) !== Number.isFinite(rankOf(b))) return Number.isFinite(rankOf(a)) ? -1 : 1;
    return countB - countA || a.localeCompare(b);
  });
};

/** The user's tags with their counts, in the user's order. */
export function useOrderedTags(tagCounts: Record<string, number>): [string, number][] {
  const { data: order = [] } = useTagOrder();
  return useMemo(() => orderTags(tagCounts, order), [tagCounts, order]);
}
