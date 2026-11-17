/** What the memo info panel reports about a memo's text. */
export interface MemoStats {
  words: number;
  characters: number;
  sentences: number;
  paragraphs: number;
  headings: number;
  images: number;
  links: number;
  tasksDone: number;
  tasksTotal: number;
  codeBlocks: number;
  bytes: number;
  /** Minutes at about 200 words a minute; at least 1 for any text. */
  readingMinutes: number;
}

const WORDS_PER_MINUTE = 200;

/** The memo's prose: no code, markup, URLs or tag marks, so counts reflect what a reader reads. */
const toPlainText = (markdown: string): string =>
  markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+)/gm, "")
    .replace(/[*_~=]{1,3}/g, "")
    .replace(/\\#/g, "#");

/**
 * Counts for one memo. `attachmentImages` adds images attached outside the text. Vietnamese
 * words are counted per syllable, the way word counters for Vietnamese usually do.
 */
export function computeMemoStats(content: string, attachmentImages = 0): MemoStats {
  const withoutCode = content.replace(/```[\s\S]*?```/g, "");
  const plain = toPlainText(content);
  const words = plain.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  const sentences = plain
    .split(/[.!?…]+(?=\s|$)|\n+/u)
    .map((part) => part.trim())
    .filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
  const paragraphs = withoutCode.split(/\n\s*\n/).filter((block) => /[\p{L}\p{N}]/u.test(toPlainText(block))).length;
  const tasks = content.match(/^\s*[-*+]\s+\[[ xX]\]/gm) ?? [];
  const tasksDone = tasks.filter((task) => /\[[xX]\]/.test(task)).length;
  const markdownLinks = content.match(/(?<!!)\[[^\]]*\]\([^)]+\)/g)?.length ?? 0;
  const bareLinks = content.replace(/\[[^\]]*\]\([^)]+\)/g, "").match(/https?:\/\/\S+/g)?.length ?? 0;
  const images = (content.match(/!\[[^\]]*\]\([^)]+\)|<img\b/gi)?.length ?? 0) + attachmentImages;

  return {
    words,
    characters: [...plain.replace(/\s+/g, "")].length,
    sentences,
    paragraphs,
    headings: withoutCode.match(/^\s{0,3}#{1,6}\s+\S/gm)?.length ?? 0,
    images,
    links: markdownLinks + bareLinks,
    tasksDone,
    tasksTotal: tasks.length,
    codeBlocks: (content.match(/^```/gm)?.length ?? 0) >> 1,
    bytes: new TextEncoder().encode(content).length,
    readingMinutes: words ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0,
  };
}

/** "1,2 KB" style sizes. */
export const formatBytes = (bytes: number, locale?: string): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString(locale, { maximumFractionDigits: 1 })} ${units[unit]}`;
};
