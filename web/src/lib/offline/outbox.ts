import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { Code } from "@connectrpc/connect";
import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { memoServiceClient } from "@/connect";
import { hasConnectCode } from "@/lib/error";
import { type Memo, MemoSchema } from "@/types/proto/api/memo_service_pb";
import { offlineGet, offlineSet } from "./store";

/**
 * Memos written while offline wait here, on this device, until the server can be reached:
 * new memos (and comments) are created, edits are applied, in the order they were made.
 *
 * An edit only lands if the memo has not changed on the server since it was opened offline.
 * Otherwise (changed elsewhere, or deleted meanwhile) the offline text is kept as a new memo
 * instead of overwriting the other change, so nothing written on either side is lost.
 */
export type OutboxEntry =
  | { id: string; kind: "create"; at: number; memo: Memo; parent?: string }
  | { id: string; kind: "update"; at: number; name: string; update: Partial<Memo>; mask: string[]; baseUpdateTime?: number };

const OUTBOX_KEY = "outbox";
/** Names given to memos created offline until the server names them. */
export const OFFLINE_MEMO_PREFIX = "memos/offline-";

let entries: OutboxEntry[] = [];
let syncing = false;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
let snapshot = { entries, syncing };
const publish = () => {
  snapshot = { entries, syncing };
  notify();
};

const save = async () => {
  await offlineSet(OUTBOX_KEY, entries);
  publish();
};

export const loadOutbox = async () => {
  entries = (await offlineGet<OutboxEntry[]>(OUTBOX_KEY)) ?? [];
  publish();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const useOutbox = () =>
  useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const timeOf = (memo?: Partial<Memo>) => {
  const time = memo?.updateTime;
  return time ? Number(time.seconds) * 1000 + Math.floor(time.nanos / 1e6) : undefined;
};

/** Queues a new memo; answers the stand-in the editor shows until it syncs. */
export async function queueCreate(memo: Memo, parent?: string): Promise<Memo> {
  const id = newId();
  entries = [...entries, { id, kind: "create", at: Date.now(), memo, parent }];
  await save();
  return { ...memo, name: `${OFFLINE_MEMO_PREFIX}${id}` };
}

/** Queues an edit of `base` (the memo as this device last saw it). */
export async function queueUpdate(base: Memo | undefined, update: Partial<Memo>, mask: string[]): Promise<Memo> {
  const name = update.name as string;
  if (name.startsWith(OFFLINE_MEMO_PREFIX)) {
    // An edit of a memo that is itself still waiting: fold it into that memo.
    const id = name.slice(OFFLINE_MEMO_PREFIX.length);
    entries = entries.map((entry) =>
      entry.kind === "create" && entry.id === id ? { ...entry, memo: { ...entry.memo, ...update, name: entry.memo.name } } : entry,
    );
  } else {
    entries = [...entries, { id: newId(), kind: "update", at: Date.now(), name, update, mask, baseUpdateTime: timeOf(base) }];
  }
  await save();
  return { ...(base ?? create(MemoSchema, {})), ...update } as Memo;
}

/**
 * Sends everything waiting, oldest first. Stops at the first failure that is not a conflict and
 * keeps the rest for the next try. Answers how many entries were sent.
 */
export async function flushOutbox(queryClient: QueryClient): Promise<number> {
  if (syncing || entries.length === 0 || (typeof navigator !== "undefined" && !navigator.onLine)) return 0;
  syncing = true;
  publish();
  let sent = 0;
  try {
    while (entries.length > 0) {
      const entry = entries[0];
      if (entry.kind === "create") {
        const memo = create(MemoSchema, { ...entry.memo, name: "" } as Record<string, unknown>);
        if (entry.parent) await memoServiceClient.createMemoComment({ parent: entry.parent, comment: memo });
        else await memoServiceClient.createMemo({ memo });
      } else {
        const current = await memoServiceClient.getMemo({ name: entry.name }).catch((error: unknown) => {
          if (hasConnectCode(error, Code.NotFound, Code.PermissionDenied)) return null; // deleted meanwhile
          throw error;
        });
        const changedElsewhere = !current || (entry.baseUpdateTime !== undefined && (timeOf(current) ?? 0) > entry.baseUpdateTime);
        if (changedElsewhere) {
          // Both sides changed, or the memo is gone: keep the offline text as its own memo.
          if (typeof entry.update.content === "string") {
            await memoServiceClient.createMemo({
              memo: create(MemoSchema, { content: entry.update.content, visibility: current?.visibility }),
            });
          }
        } else {
          await memoServiceClient.updateMemo({
            memo: create(MemoSchema, entry.update as Record<string, unknown>),
            updateMask: create(FieldMaskSchema, { paths: entry.mask }),
          });
        }
      }
      entries = entries.slice(1);
      sent++;
      await save();
    }
  } catch (error) {
    console.warn("Offline sync stopped; will retry:", error);
  } finally {
    syncing = false;
    publish();
    if (sent > 0) await queryClient.invalidateQueries();
  }
  return sent;
}

/** Drops everything waiting (sign-out). */
export async function clearOutbox() {
  entries = [];
  await save();
}

/** Flushes now, whenever the connection returns, and every minute while something waits. */
export function startOutboxSync(queryClient: QueryClient): () => void {
  const flush = () => void flushOutbox(queryClient);
  window.addEventListener("online", flush);
  const timer = window.setInterval(() => entries.length > 0 && flush(), 60_000);
  void loadOutbox().then(flush);
  return () => {
    window.removeEventListener("online", flush);
    window.clearInterval(timer);
  };
}
