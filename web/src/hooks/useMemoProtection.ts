import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import useCurrentUser from "@/hooks/useCurrentUser";
import { forkFetch } from "@/lib/fork-api";
import { decryptMemoContent, getSessionKey, isLockedContent, subscribeSessionKey } from "@/lib/memo-crypto";
import { getPasskeyRecord } from "@/lib/passkey";

export type MemoProtectionMode = "blur" | "lock";

export const protectionKeys = {
  all: ["memo-protections"] as const,
  passkey: ["passkey-record"] as const,
};

const uidOf = (memoName: string) => memoName.split("/").pop() ?? "";

/** How each of the current user's memos is protected, by uid; memos not listed are not. */
export function useMemoProtections() {
  const currentUser = useCurrentUser();
  return useQuery({
    queryKey: protectionKeys.all,
    enabled: Boolean(currentUser),
    staleTime: 60_000,
    queryFn: async () => (await forkFetch<{ protections: Record<string, MemoProtectionMode> }>("/api/x/memo-protections")).protections,
  });
}

export function useMemoProtectionMode(memoName: string): MemoProtectionMode | undefined {
  const { data } = useMemoProtections();
  return data?.[uidOf(memoName)];
}

export function useSetMemoProtection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memoName, mode }: { memoName: string; mode: MemoProtectionMode | "none" }) =>
      forkFetch(`/api/x/memos/${encodeURIComponent(uidOf(memoName))}/protection`, { method: "PUT", body: { mode } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: protectionKeys.all }),
  });
}

export function usePasskeyRecord() {
  const currentUser = useCurrentUser();
  return useQuery({
    queryKey: protectionKeys.passkey,
    enabled: Boolean(currentUser),
    queryFn: getPasskeyRecord,
  });
}

/** The key this tab unlocked with the passkey, or null while locked. */
export const useSessionKey = () => useSyncExternalStore(subscribeSessionKey, getSessionKey, () => null);

/**
 * A locked memo's plaintext once this tab holds the key: `locked` says whether the content is
 * encrypted at all, `plain` is its text (or the content itself when it is not locked), null
 * while locked or decrypting.
 */
export function useDecryptedContent(content: string): { locked: boolean; plain: string | null; failed: boolean } {
  const key = useSessionKey();
  const locked = isLockedContent(content);
  const [state, setState] = useState<{ source: string; key: CryptoKey | null; plain: string | null; failed: boolean }>({
    source: "",
    key: null,
    plain: null,
    failed: false,
  });
  useEffect(() => {
    if (!locked || !key) return;
    let cancelled = false;
    decryptMemoContent(content, key)
      .then((plain) => !cancelled && setState({ source: content, key, plain, failed: false }))
      .catch(() => !cancelled && setState({ source: content, key, plain: null, failed: true }));
    return () => {
      cancelled = true;
    };
  }, [content, key, locked]);
  if (!locked) return { locked, plain: content, failed: false };
  const current = state.source === content && state.key === key;
  return { locked, plain: current ? state.plain : null, failed: current && state.failed };
}
