import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { memoServiceClient } from "@/connect";
import { forkFetch } from "@/lib/fork-api";
import { decryptMemoContent, encryptMemoContent, isLockedContent, renameTagInText } from "@/lib/memo-crypto";
import { MemoSchema } from "@/types/proto/api/memo_service_pb";

const setProtection = (memoName: string, mode: "blur" | "lock" | "none") =>
  forkFetch(`/api/x/memos/${encodeURIComponent(memoName.split("/").pop() ?? "")}/protection`, { method: "PUT", body: { mode } });

const saveContent = (name: string, content: string) =>
  memoServiceClient.updateMemo({
    memo: create(MemoSchema, { name, content }),
    updateMask: create(FieldMaskSchema, { paths: ["content"] }),
  });

/**
 * Locks a memo: saves its content encrypted, then marks it locked, which also clears its kept
 * versions (they hold the plaintext). The order matters: the encrypted save itself keeps the
 * plaintext as a version until the lock clears it.
 */
export async function lockMemo(memoName: string, key: CryptoKey): Promise<void> {
  const memo = await memoServiceClient.getMemo({ name: memoName });
  if (!isLockedContent(memo.content)) await saveContent(memoName, await encryptMemoContent(memo.content, key));
  await setProtection(memoName, "lock");
}

/** Removes the lock: saves the decrypted content and clears the mode. */
export async function unlockMemo(memoName: string, key: CryptoKey): Promise<void> {
  const memo = await memoServiceClient.getMemo({ name: memoName });
  if (isLockedContent(memo.content)) await saveContent(memoName, await decryptMemoContent(memo.content, key));
  await setProtection(memoName, "none");
}

/**
 * Re-encrypts locked memos from one key to another (a passkey change). A memo `from` does not
 * open is left as it is: it is already under `to`, or under neither.
 */
export async function reencryptMemos(memoNames: readonly string[], from: CryptoKey, to: CryptoKey, onProgress?: (done: number) => void) {
  let done = 0;
  for (const name of memoNames) {
    const memo = await memoServiceClient.getMemo({ name });
    const plain = isLockedContent(memo.content) ? await decryptMemoContent(memo.content, from).catch(() => null) : null;
    if (plain !== null) {
      await saveContent(name, await encryptMemoContent(plain, to));
      // Relocking clears the version the save kept, which the old passkey could still open.
      await setProtection(name, "lock");
    }
    onProgress?.(++done);
  }
}

/** Renames a tag inside locked memos too: the server could only rename it on their readable line. */
export async function renameTagInLockedMemos(memoNames: readonly string[], from: string, to: string, key: CryptoKey) {
  for (const name of memoNames) {
    const memo = await memoServiceClient.getMemo({ name });
    if (!isLockedContent(memo.content)) continue;
    const plain = await decryptMemoContent(memo.content, key);
    const renamed = renameTagInText(plain, from, to);
    if (renamed !== plain) await saveContent(name, await encryptMemoContent(renamed, key));
  }
}

export const setMemoBlur = (memoName: string, blurred: boolean) => setProtection(memoName, blurred ? "blur" : "none");
