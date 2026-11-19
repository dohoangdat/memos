import { describe, expect, it } from "vitest";
import { buildTagTree } from "@/components/TagTree";
import { orderTags } from "@/hooks/useTagOrder";

describe("tag order", () => {
  it("puts ordered tags first, then the rest by use and name", () => {
    const counts = { a: 1, b: 9, c: 5, d: 5, e: 2 };
    expect(orderTags(counts, ["e", "a"]).map(([tag]) => tag)).toEqual(["e", "a", "b", "c", "d"]);
    expect(orderTags(counts, []).map(([tag]) => tag)).toEqual(["b", "c", "d", "e", "a"]);
  });

  it("builds the tree in that order, siblings included", () => {
    const tree = buildTagTree(orderTags({ work: 3, "work/b": 1, "work/a": 2, home: 5 }, ["work", "work/b", "work/a", "home"]));
    expect(tree.map((node) => node.key)).toEqual(["work", "home"]);
    expect(tree[0].subTags.map((node) => node.key)).toEqual(["b", "a"]);
  });
});
