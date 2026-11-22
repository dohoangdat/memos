import { describe, expect, it } from "vitest";
import { buildSharedMemoContent } from "@/utils/share-target";

describe("buildSharedMemoContent", () => {
  it("puts the title, text and link on their own lines and tags the memo", () => {
    expect(buildSharedMemoContent({ title: "Bài hay", text: "Đọc thử nhé", url: "https://example.com/a" })).toBe(
      "**Bài hay**\n\nĐọc thử nhé\n\nhttps://example.com/a\n\n#chia-se",
    );
  });

  it("pulls a link out of the text when the app sends no url (Facebook, TikTok)", () => {
    expect(buildSharedMemoContent({ text: "Xem video này https://vt.tiktok.com/ZS123/ hay lắm" })).toBe(
      "Xem video này hay lắm\n\nhttps://vt.tiktok.com/ZS123/\n\n#chia-se",
    );
    expect(buildSharedMemoContent({ text: "https://www.facebook.com/share/p/1AbC/" })).toBe(
      "https://www.facebook.com/share/p/1AbC/\n\n#chia-se",
    );
  });

  it("drops a link or title the app repeats", () => {
    expect(buildSharedMemoContent({ title: "https://a.vn", text: "https://a.vn", url: "https://a.vn" })).toBe("https://a.vn\n\n#chia-se");
    expect(buildSharedMemoContent({ title: "Same", text: "Same" })).toBe("**Same**\n\n#chia-se");
  });

  it("keeps shared hashtags as text so they do not become tags", () => {
    expect(buildSharedMemoContent({ text: "trend mới #fyp #xuhuong" })).toBe("trend mới \\#fyp \\#xuhuong\n\n#chia-se");
  });

  it("returns nothing when nothing was shared", () => {
    expect(buildSharedMemoContent({ title: " ", text: "", url: null })).toBe("");
  });
});

describe("shared link page details (fork)", () => {
  it("writes the page title and description when the app shared only a link", () => {
    expect(
      buildSharedMemoContent(
        { text: "https://vnexpress.net/a" },
        { title: "Lãi suất #tiết-kiệm giảm", description: "Nhiều ngân hàng hạ lãi suất." },
      ),
    ).toBe("**Lãi suất \\#tiết-kiệm giảm**\n\n> Nhiều ngân hàng hạ lãi suất.\n\nhttps://vnexpress.net/a\n\n#chia-se");
  });

  it("keeps the app's own title and skips a description it already shared", () => {
    expect(
      buildSharedMemoContent({ title: "Bài hay", text: "Đọc thử", url: "https://x.vn" }, { title: "Trang X", description: "Đọc thử" }),
    ).toBe("**Bài hay**\n\nĐọc thử\n\nhttps://x.vn\n\n#chia-se");
  });
});
