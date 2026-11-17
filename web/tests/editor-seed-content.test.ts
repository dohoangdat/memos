import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { initialEditorState } from "@/components/MemoEditor/edit/initialState";
import { cacheService } from "@/components/MemoEditor/edit/services/cacheService";
import { MemoSchema } from "@/types/proto/api/memo_service_pb";

describe("initialEditorState seedContent (shared from another app)", () => {
  it("starts a new memo with the shared text, over a restored draft", () => {
    const draftKey = cacheService.key("users/1", "new:share");
    cacheService.saveNow(draftKey, { ...cacheService.loadDraft(draftKey), content: "old draft" });
    expect(initialEditorState({ draftKey, seedContent: "https://a.vn\n\n#chia-se" }).content).toBe("https://a.vn\n\n#chia-se");
    expect(initialEditorState({ draftKey }).content).toBe("old draft");
  });

  it("adds the shared text after an existing memo's own", () => {
    const memo = create(MemoSchema, { name: "memos/1", content: "Notes\n\n#tag\n\n" });
    const state = initialEditorState({ memo, draftKey: cacheService.key("users/1", "edit:memos/1"), seedContent: "https://a.vn" });
    expect(state.content).toBe("Notes\n\n#tag\n\nhttps://a.vn");
  });
});
