import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ensurePasskey } from "@/components/Passkey/passkeyPrompt";
import { useAuth } from "@/contexts/AuthContext";
import { type MemoProtectionMode, protectionKeys } from "@/hooks/useMemoProtection";
import { memoKeys } from "@/hooks/useMemoQueries";
import { userKeys } from "@/hooks/useUserQueries";
import { forkFetch } from "@/lib/fork-api";
import { renameTagInLockedMemos } from "@/lib/memo-lock";
import { useTranslate } from "@/utils/i18n";

export interface RenameTagResult {
  /** Memos whose text changed. */
  updated: number;
  /** Locked memos whose encrypted text still holds the old tag (the passkey was not given). */
  lockedPending: number;
}

/**
 * Renames a tag, and the tags under it, in every memo of the current user (server/tagrename).
 * The server can only rename a locked memo's readable tag line, so the tag inside its encrypted
 * text is renamed here, with the passkey.
 */
export function useRenameTag() {
  const t = useTranslate();
  const queryClient = useQueryClient();
  const { refetchSettings } = useAuth();
  return useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }): Promise<RenameTagResult> => {
      const { updated } = await forkFetch<{ updated: string[] }>("/api/x/tags/rename", { method: "POST", body: { from, to } });
      const protections = queryClient.getQueryData<Record<string, MemoProtectionMode>>(protectionKeys.all) ?? {};
      const locked = updated.filter((name) => protections[name.split("/").pop() ?? ""] === "lock");
      let lockedPending = 0;
      if (locked.length > 0) {
        const key = await ensurePasskey(t("tag-rename.locked-reason"));
        if (key) await renameTagInLockedMemos(locked, from, to, key);
        else lockedPending = locked.length;
      }
      return { updated: updated.length, lockedPending };
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: memoKeys.all }),
        queryClient.invalidateQueries({ queryKey: userKeys.stats() }),
        refetchSettings(),
      ]);
    },
  });
}
