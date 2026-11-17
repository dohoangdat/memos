const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `#tag` as a whole tag: not a prefix of `#tag/child` or `#tagged`. */
const tagPattern = (tag: string) => new RegExp(`(^|[ \\t])#${escapeRegExp(tag)}(?=\\s|$)`, "gm");

/** A line made only of tags, such as the tag line at the end of a memo. */
const isTagLine = (line: string) => /^\s*(#[^\s#]+\s*)+$/.test(line);

export const hasTag = (markdown: string, tag: string): boolean => tagPattern(tag).test(markdown);

/**
 * Adds `#tag` to the memo's tag line: the last line when it holds only tags, otherwise a new
 * line at the end. A tag the memo already has is left alone.
 */
export function addTagToMarkdown(markdown: string, tag: string): string {
  if (hasTag(markdown, tag)) return markdown;
  const trimmed = markdown.replace(/\s+$/, "");
  if (!trimmed) return `#${tag}`;
  const lines = trimmed.split("\n");
  const last = lines[lines.length - 1];
  if (isTagLine(last)) {
    lines[lines.length - 1] = `${last.trimEnd()} #${tag}`;
    return lines.join("\n");
  }
  return `${trimmed}\n\n#${tag}`;
}

/** Removes every `#tag` (exactly that tag); a tag line left empty goes with it. */
export function removeTagFromMarkdown(markdown: string, tag: string): string {
  const lines: string[] = [];
  for (const line of markdown.split("\n")) {
    if (!tagPattern(tag).test(line)) {
      lines.push(line);
      continue;
    }
    const indent = isTagLine(line) ? "" : (line.match(/^[ \t]*/)?.[0] ?? "");
    const rest = line
      .replace(tagPattern(tag), "$1")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    if (rest) lines.push(indent + rest);
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/, "");
}
