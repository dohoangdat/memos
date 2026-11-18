import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { pushSearchHistory, SEARCH_HISTORY_LIMIT, useSearchHistory } from "@/lib/search-history";

describe("search history", () => {
  afterEach(() => window.localStorage.clear());

  it("puts the newest search first, once, and keeps a bounded list", () => {
    let entries = pushSearchHistory([], { query: " budget ", mode: "text" });
    entries = pushSearchHistory(entries, { query: "travel", mode: "text" });
    entries = pushSearchHistory(entries, { query: "budget", mode: "text" });
    entries = pushSearchHistory(entries, { query: "", mode: "text" });
    expect(entries).toEqual([
      { query: "budget", mode: "text" },
      { query: "travel", mode: "text" },
    ]);
    for (let index = 0; index < SEARCH_HISTORY_LIMIT + 5; index++)
      entries = pushSearchHistory(entries, { query: `q${index}`, mode: "text" });
    expect(entries).toHaveLength(SEARCH_HISTORY_LIMIT);
    expect(entries[0].query).toBe(`q${SEARCH_HISTORY_LIMIT + 4}`);
  });

  it("remembers searches per account on this device", () => {
    const first = renderHook(() => useSearchHistory("users/a"));
    act(() => first.result.current.add({ query: "tax", mode: "text" }));
    act(() => first.result.current.add({ query: '"x" in tags', mode: "cel" }));
    expect(renderHook(() => useSearchHistory("users/a")).result.current.entries.map((entry) => entry.query)).toEqual([
      '"x" in tags',
      "tax",
    ]);
    expect(renderHook(() => useSearchHistory("users/b")).result.current.entries).toEqual([]);

    act(() => first.result.current.remove({ query: "tax", mode: "text" }));
    expect(first.result.current.entries).toEqual([{ query: '"x" in tags', mode: "cel" }]);
    act(() => first.result.current.clear());
    expect(renderHook(() => useSearchHistory("users/a")).result.current.entries).toEqual([]);
  });
});
