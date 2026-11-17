import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useBackToClose } from "@/hooks/useBackToClose";
import { computeMemoStats, formatBytes } from "@/utils/memo-stats";
import { addTagToMarkdown, hasTag, removeTagFromMarkdown } from "@/utils/memo-tags-markdown";

describe("computeMemoStats", () => {
  const memo = [
    "# Kế hoạch tuần",
    "",
    "Đi chợ sáng nay. Mua rau và cá! Xem [link](https://a.vn) nhé?",
    "",
    "- [x] Việc một",
    "- [ ] Việc hai",
    "",
    "![ảnh](/file/attachments/abc) https://b.vn",
    "",
    "```js",
    "const ignored = 1;",
    "```",
    "",
    "#todo",
  ].join("\n");

  it("counts what a reader reads, not code or markup", () => {
    const stats = computeMemoStats(memo, 2);
    expect(stats.headings).toBe(1);
    expect(stats.tasksTotal).toBe(2);
    expect(stats.tasksDone).toBe(1);
    expect(stats.images).toBe(3);
    expect(stats.links).toBe(2);
    expect(stats.codeBlocks).toBe(1);
    expect(stats.paragraphs).toBe(5);
    expect(stats.sentences).toBeGreaterThanOrEqual(6);
    expect(stats.words).toBeGreaterThan(15);
    expect(stats.readingMinutes).toBe(1);
    expect(stats.bytes).toBe(new TextEncoder().encode(memo).length);
  });

  it("reports nothing for an empty memo", () => {
    expect(computeMemoStats("")).toMatchObject({ words: 0, sentences: 0, paragraphs: 0, readingMinutes: 0 });
  });

  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048, "en")).toBe("2 KB");
  });
});

describe("tags in markdown", () => {
  it("adds a tag to the trailing tag line, or starts one", () => {
    expect(addTagToMarkdown("Text\n\n#a", "b/c")).toBe("Text\n\n#a #b/c");
    expect(addTagToMarkdown("Text", "b")).toBe("Text\n\n#b");
    expect(addTagToMarkdown("", "b")).toBe("#b");
    expect(addTagToMarkdown("Text #b here", "b")).toBe("Text #b here");
  });

  it("removes exactly that tag and an emptied tag line", () => {
    expect(removeTagFromMarkdown("Text\n\n#a #a/b #ab", "a")).toBe("Text\n\n#a/b #ab");
    expect(removeTagFromMarkdown("  - task #a done", "a")).toBe("  - task done");
    expect(removeTagFromMarkdown("Text\n\n#a", "a")).toBe("Text");
    expect(hasTag("x #a/b", "a")).toBe(false);
    expect(hasTag("x #a/b", "a/b")).toBe(true);
  });
});

describe("useBackToClose", () => {
  it("closes on Back and cleans up its history entry when closed otherwise", async () => {
    const start = window.history.length;
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useBackToClose(onClose));
    expect(window.history.length).toBe(start + 1);

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
    });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();

    const second = vi.fn();
    const back = vi.spyOn(window.history, "back");
    const other = renderHook(() => useBackToClose(second));
    other.unmount();
    expect(back).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });
});
