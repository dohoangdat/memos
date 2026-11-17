export type DiffLine = { type: "same" | "add" | "del"; text: string };

/** Above this many cells the exact table would be too slow; the diff falls back to whole-line counts. */
const MAX_TABLE_CELLS = 4_000_000;

/**
 * A line diff from `before` to `after`, like `git diff`: unchanged lines, then the lines removed
 * and added around each change. Exact (longest common subsequence) for memo-sized texts.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // Common prefix and suffix need no table.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head: DiffLine[] = a.slice(0, start).map((text) => ({ type: "same", text }));
  const tail: DiffLine[] = a.slice(endA).map((text) => ({ type: "same", text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  const n = midA.length;
  const m = midB.length;
  if (n * m > MAX_TABLE_CELLS) {
    return [
      ...head,
      ...midA.map((text): DiffLine => ({ type: "del", text })),
      ...midB.map((text): DiffLine => ({ type: "add", text })),
      ...tail,
    ];
  }
  // lcs[i][j]: longest common subsequence of midA[i..] and midB[j..].
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        midA[i] === midB[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      middle.push({ type: "same", text: midA[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      middle.push({ type: "del", text: midA[i++] });
    } else {
      middle.push({ type: "add", text: midB[j++] });
    }
  }
  while (i < n) middle.push({ type: "del", text: midA[i++] });
  while (j < m) middle.push({ type: "add", text: midB[j++] });
  return [...head, ...middle, ...tail];
}

/** Lines added and removed, as `git diff --stat` counts them. */
export function diffStat(lines: readonly DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === "add") added++;
    else if (line.type === "del") removed++;
  }
  return { added, removed };
}

export type DiffHunkLine = DiffLine | { type: "skip"; count: number };

/** The changed lines with `context` unchanged lines around them; longer unchanged runs fold into a skip. */
export function withContext(lines: readonly DiffLine[], context = 2): DiffHunkLine[] {
  const keep = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.type === "same") return;
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) keep[k] = true;
  });
  const result: DiffHunkLine[] = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped) result.push({ type: "skip", count: skipped });
      skipped = 0;
      result.push(line);
    } else {
      skipped++;
    }
  });
  if (skipped) result.push({ type: "skip", count: skipped });
  return result;
}
