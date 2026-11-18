import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ensurePasskey } from "@/components/Passkey/passkeyPrompt";
import { protectionKeys, useMemoProtectionMode } from "@/hooks/useMemoProtection";
import { memoKeys } from "@/hooks/useMemoQueries";
import { isLockedContent } from "@/lib/memo-crypto";
import { lockMemo, setMemoBlur, unlockMemo } from "@/lib/memo-lock";
import { showErrorToast, toast } from "@/lib/toast";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

/** Blur and passkey lock for one memo, as the action menu offers them. */
export function useMemoProtectActions(memo: Memo) {
  const t = useTranslate();
  const queryClient = useQueryClient();
  const mode = useMemoProtectionMode(memo.name);
  const locked = isLockedContent(memo.content) || mode === "lock";
  const blurred = mode === "blur";
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>, success: Parameters<typeof t>[0]) => {
    setBusy(true);
    try {
      await action();
      toast.add({ title: t(success), type: "success" });
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t("common.error-occurred"));
    } finally {
      setBusy(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: protectionKeys.all }),
        queryClient.invalidateQueries({ queryKey: memoKeys.all }),
      ]);
    }
  };

  const toggleBlur = () =>
    run(() => setMemoBlur(memo.name, !blurred).then(() => undefined), blurred ? "protect.unblurred" : "protect.blurred");

  const toggleLock = async () => {
    const key = await ensurePasskey(locked ? t("protect.unlock-reason") : t("protect.lock-reason"));
    if (!key) return;
    await run(() => (locked ? unlockMemo(memo.name, key) : lockMemo(memo.name, key)), locked ? "protect.unlocked" : "protect.locked");
  };

  return { locked, blurred, busy, toggleBlur, toggleLock };
}
