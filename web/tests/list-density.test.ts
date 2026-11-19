import { describe, expect, it } from "vitest";
import { memoSummary } from "@/lib/list-density";

describe("compact list summary", () => {
  it("takes the first line as title and the rest as description, as plain text", () => {
    expect(
      memoSummary("# Kế hoạch **Q4**\n\n- [ ] gọi [ngân hàng](https://x.vn)\n```\ncode\n```\n![img](/a.png) xong\n\n#tai-chinh #ca-nhan"),
    ).toEqual({
      title: "Kế hoạch Q4",
      description: "gọi ngân hàng xong",
    });
    expect(memoSummary("")).toEqual({ title: "", description: "" });
  });
});
