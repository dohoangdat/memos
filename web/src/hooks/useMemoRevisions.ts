import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRequestToken } from "@/connect";
import { useUpdateMemo } from "@/hooks/useMemoQueries";

/** One earlier version of a memo's content, as server/revision keeps it. */
export interface MemoRevision {
  id: number;
  createTime: string;
  content: string;
  sizeBytes: number;
}

const revisionKeys = { list: (memoName: string) => ["memo-revisions", memoName] as const };

/**
 * A memo's earlier versions, newest first (fork-only endpoint). Empty where the server keeps
 * none: another database driver, or a memo the viewer cannot edit.
 */
export function useMemoRevisions(memoName: string, enabled: boolean) {
  return useQuery({
    queryKey: revisionKeys.list(memoName),
    enabled,
    staleTime: 0,
    queryFn: async (): Promise<MemoRevision[]> => {
      const uid = memoName.split("/").pop() ?? "";
      const token = await getRequestToken();
      const response = await fetch(`/api/x/memos/${encodeURIComponent(uid)}/revisions`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (response.status === 404 || response.status === 501) return [];
      if (!response.ok) throw new Error(`Failed to load revisions (HTTP ${response.status})`);
      const body = (await response.json()) as { revisions?: MemoRevision[] };
      return body.revisions ?? [];
    },
  });
}

/** Restores a revision: an ordinary content update, so the content it replaces becomes a revision too. */
export function useRestoreMemoRevision(memoName: string) {
  const queryClient = useQueryClient();
  const { mutateAsync: updateMemo } = useUpdateMemo(memoName);
  return useMutation({
    mutationFn: (revision: MemoRevision) => updateMemo({ update: { name: memoName, content: revision.content }, updateMask: ["content"] }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: revisionKeys.list(memoName) }),
  });
}
