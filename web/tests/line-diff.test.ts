import { describe, expect, it } from "vitest";
import { diffLines, diffStat, withContext } from "@/utils/line-diff";
import { countMemoOpen, topOpenedMemoUids } from "@/utils/memo-opens";

describe("diffLines", () => {
  it("counts added and removed lines like git", () => {
    const before = "a\nb\nc\nd";
    const after = "a\nB\nc\nd\ne";
    const lines = diffLines(before, after);
    expect(diffStat(lines)).toEqual({ added: 2, removed: 1 });
    expect(lines.filter((line) => line.type !== "del").map((line) => line.text)).toEqual(after.split("\n"));
    expect(lines.filter((line) => line.type !== "add").map((line) => line.text)).toEqual(before.split("\n"));
  });

  it("reports nothing for identical text", () => {
    expect(diffStat(diffLines("x\ny", "x\ny"))).toEqual({ added: 0, removed: 0 });
  });

  it("folds long unchanged runs around the changes", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 10", "LINE 10");
    const hunk = withContext(diffLines(before, after), 2);
    expect(hunk[0]).toEqual({ type: "skip", count: 8 });
    expect(hunk.filter((line) => line.type === "add" || line.type === "del")).toHaveLength(2);
    expect(hunk.at(-1)).toEqual({ type: "skip", count: 7 });
  });
});

describe("memo opens", () => {
  it("ranks memos by how often they were opened on this device", () => {
    localStorage.clear();
    countMemoOpen("memos/a");
    countMemoOpen("memos/b");
    countMemoOpen("memos/b");
    expect(topOpenedMemoUids()).toEqual(["b", "a"]);
    expect(topOpenedMemoUids(1)).toEqual(["b"]);
  });
});
