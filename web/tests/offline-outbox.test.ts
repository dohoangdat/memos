import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoSchema } from "@/types/proto/api/memo_service_pb";

const client = vi.hoisted(() => ({
  createMemo: vi.fn(),
  createMemoComment: vi.fn(),
  getMemo: vi.fn(),
  updateMemo: vi.fn(),
}));
vi.mock("@/connect", () => ({ memoServiceClient: client }));

import { renderHook } from "@testing-library/react";
import { clearOutbox, flushOutbox, OFFLINE_MEMO_PREFIX, queueCreate, queueUpdate, useOutbox } from "@/lib/offline/outbox";

const at = (iso: string) => timestampFromDate(new Date(iso));
const pending = () => renderHook(() => useOutbox()).result.current.entries;

describe("offline outbox", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearOutbox();
  });
  afterEach(() => vi.restoreAllMocks());

  it("creates queued memos in order once online, and folds edits of a waiting memo into it", async () => {
    const draft = await queueCreate(create(MemoSchema, { content: "first" }));
    expect(draft.name.startsWith(OFFLINE_MEMO_PREFIX)).toBe(true);
    await queueUpdate(draft, { name: draft.name, content: "first, edited" }, ["content"]);
    await queueCreate(create(MemoSchema, { content: "reply" }), "memos/parent");
    expect(pending()).toHaveLength(2);

    expect(await flushOutbox(new QueryClient())).toBe(2);
    expect(client.createMemo).toHaveBeenCalledWith({ memo: expect.objectContaining({ content: "first, edited", name: "" }) });
    expect(client.createMemoComment).toHaveBeenCalledWith({
      parent: "memos/parent",
      comment: expect.objectContaining({ content: "reply" }),
    });
    expect(pending()).toHaveLength(0);
  });

  it("applies an offline edit when the memo did not change meanwhile", async () => {
    const base = create(MemoSchema, { name: "memos/a", content: "old", updateTime: at("2026-11-18T10:00:00Z") });
    await queueUpdate(base, { name: "memos/a", content: "new" }, ["content"]);
    client.getMemo.mockResolvedValue(base);
    await flushOutbox(new QueryClient());
    expect(client.updateMemo).toHaveBeenCalledOnce();
    expect(client.createMemo).not.toHaveBeenCalled();
  });

  it("keeps an offline edit as a new memo when the memo changed elsewhere", async () => {
    const base = create(MemoSchema, { name: "memos/a", content: "old", updateTime: at("2026-11-18T10:00:00Z") });
    await queueUpdate(base, { name: "memos/a", content: "offline text" }, ["content"]);
    client.getMemo.mockResolvedValue({ ...base, content: "changed on the server", updateTime: at("2026-11-18T11:00:00Z") });
    await flushOutbox(new QueryClient());
    expect(client.updateMemo).not.toHaveBeenCalled();
    expect(client.createMemo).toHaveBeenCalledWith({ memo: expect.objectContaining({ content: "offline text" }) });
  });

  it("keeps an offline edit as a new memo when the memo was deleted meanwhile", async () => {
    const base = create(MemoSchema, { name: "memos/gone", content: "old", updateTime: at("2026-11-18T10:00:00Z") });
    await queueUpdate(base, { name: "memos/gone", content: "offline text" }, ["content"]);
    client.getMemo.mockRejectedValue(new ConnectError("not found", Code.NotFound));
    expect(await flushOutbox(new QueryClient())).toBe(1);
    expect(client.createMemo).toHaveBeenCalledWith({ memo: expect.objectContaining({ content: "offline text" }) });
  });

  it("keeps what failed for the next try", async () => {
    await queueCreate(create(MemoSchema, { content: "a" }));
    await queueCreate(create(MemoSchema, { content: "b" }));
    client.createMemo.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("Failed to fetch"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await flushOutbox(new QueryClient())).toBe(1);
    expect(pending().map((entry) => (entry.kind === "create" ? entry.memo.content : ""))).toEqual(["b"]);
  });
});
