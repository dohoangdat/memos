import DOMPurify from "dompurify";
import { Marked } from "marked";
import TurndownService from "turndown";

/**
 * Conversion between a memo's Markdown and the classic editor's HTML.
 *
 * Markdown stays the storage format. A top-level block whose formatting Markdown cannot
 * express (alignment, color, font, size, underline, columns, complex tables) is stored as
 * one raw HTML block instead, which the memo view renders through memos' sanitizer.
 * Everything else round-trips as plain Markdown, so tags, links and checklists in it keep
 * working on the server.
 */

const marked = new Marked({ gfm: true, breaks: true });

/**
 * An element in a document of its own. Markdown may carry raw HTML (a shared link can put
 * `<img onerror=…>` in a draft), and HTML set on an element of the page itself loads images and
 * runs their handlers even while the element is detached. In a separate document nothing loads
 * or runs.
 */
const inertRoot = (html: string): HTMLDivElement => {
  const root = document.implementation.createHTMLDocument("").createElement("div");
  root.innerHTML = html;
  return root;
};

/** memos turns setext headings off: a line followed by `---` is a paragraph and a divider. */
const separateSetextDividers = (markdown: string): string => markdown.replace(/^([^\n]*\S[^\n]*)\n(\s{0,3}-{3,}\s*)$/gm, "$1\n\n$2");

/** GFM task lists, as marked renders them, in the shape TipTap's TaskList parses. */
const toTaskLists = (root: HTMLElement) => {
  for (const list of Array.from(root.querySelectorAll("ul"))) {
    const items = Array.from(list.children).filter((child) => child.localName === "li");
    const boxes = items.map((item) => item.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]'));
    if (!items.length || boxes.some((box) => !box)) continue;
    list.setAttribute("data-type", "taskList");
    items.forEach((item, index) => {
      const box = boxes[index] as HTMLInputElement;
      item.setAttribute("data-type", "taskItem");
      item.setAttribute("data-checked", String(box.hasAttribute("checked")));
      box.remove();
    });
  }
};

export function markdownToHtml(markdown: string): string {
  if (!markdown.trim()) return "";
  const html = marked.parse(separateSetextDividers(markdown), { async: false }) as string;
  // Event handlers, scripts and `javascript:` links never reach the editor.
  const root = inertRoot(DOMPurify.sanitize(html, { FORBID_TAGS: ["style"] }));
  toTaskLists(root);
  return root.innerHTML;
}

// ---------------------------------------------------------------------------
// HTML -> Markdown

const BLOCK_NAMES = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "UL", "OL", "TABLE", "DIV", "PRE"]);
/** Formatting Markdown has no syntax for. */
const RICH_ONLY = "[style], u, mark, .wpc-columns";

const isTopLevel = (node: HTMLElement) => node.parentElement?.id === "classic-root";

const isSimpleTable = (table: HTMLElement): boolean => {
  const rows = Array.from(table.querySelectorAll("tr"));
  if (!rows.length) return false;
  return Array.from(table.querySelectorAll("th, td")).every((cell) => {
    if ((cell.getAttribute("colspan") ?? "1") !== "1" || (cell.getAttribute("rowspan") ?? "1") !== "1") return false;
    if (cell.querySelector("[style], u, mark, ul, ol, pre, blockquote, table, img")) return false;
    return cell.querySelectorAll("p").length <= 1;
  });
};

const needsHtml = (node: HTMLElement): boolean => {
  if (node.localName === "table") return !isSimpleTable(node);
  if (node.matches(RICH_ONLY) || node.querySelector(RICH_ONLY)) return true;
  // A table inside a list or quote cannot be written as Markdown there.
  return Array.from(node.querySelectorAll("table")).some((table) => !isSimpleTable(table));
};

/** One line of HTML: a blank line would end the Markdown HTML block early. */
const toHtmlBlock = (node: HTMLElement): string => {
  const clone = node.cloneNode(true) as HTMLElement;
  for (const colgroup of Array.from(clone.querySelectorAll("colgroup"))) colgroup.remove();
  for (const element of [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("[style]"))]) {
    element.style.removeProperty("min-width");
    element.style.removeProperty("width");
    if (!element.getAttribute("style")?.trim()) element.removeAttribute("style");
  }
  for (const box of Array.from(clone.querySelectorAll('li[data-type="taskItem"] > label'))) {
    // Keep the checkbox the memo view understands; drop TipTap's label wrapper.
    const input = box.querySelector("input");
    if (input) box.replaceWith(input);
    else box.remove();
  }
  return clone.outerHTML.replace(/\n/g, "&#10;");
};

/**
 * Lighter escaping than turndown's: memo syntax such as `#tag`, `[[links]]`, `$math$` and
 * footnotes stays as typed. Only what would turn plain text into Markdown is escaped.
 */
const escapeMarkdown = (text: string): string =>
  text
    .replace(/\\/g, "\\\\")
    .replace(/([*_`~])/g, "\\$1")
    .replace(/^(\s*)(#{1,6})(\s)/gm, "$1\\$2$3")
    .replace(/^(\s*)([-+>])(\s)/gm, "$1\\$2$3")
    .replace(/^(\s*\d+)\.(\s)/gm, "$1\\.$2");

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
  strongDelimiter: "**",
  // memos renders a single newline as a line break.
  br: "",
});
turndown.escape = escapeMarkdown;

turndown.addRule("htmlBlock", {
  filter: (node) => BLOCK_NAMES.has(node.nodeName) && isTopLevel(node) && needsHtml(node),
  replacement: (_content, node) => `\n\n${toHtmlBlock(node as HTMLElement)}\n\n`,
});

turndown.addRule("strikethrough", {
  filter: (node) => ["S", "DEL", "STRIKE"].includes(node.nodeName),
  replacement: (content) => (content.trim() ? `~~${content}~~` : content),
});

const listItemPrefix = (item: HTMLElement): string => {
  const parent = item.parentElement;
  if (item.getAttribute("data-type") === "taskItem") return `- [${item.getAttribute("data-checked") === "true" ? "x" : " "}] `;
  if (parent?.localName === "ol") {
    const start = Number(parent.getAttribute("start") ?? "1");
    return `${start + Array.from(parent.children).indexOf(item)}. `;
  }
  return "- ";
};

turndown.addRule("listItem", {
  filter: "li",
  replacement: (content, node) => {
    const item = node as HTMLElement;
    const prefix = listItemPrefix(item);
    const body = content
      .replace(/^\n+/, "")
      .replace(/\n+$/, "")
      .replace(/\n/gm, `\n${" ".repeat(prefix.length)}`);
    return `${prefix}${body}${item.nextElementSibling ? "\n" : ""}`;
  },
});

// The checkbox inside a task item is written by the listItem rule.
turndown.addRule("taskCheckbox", {
  filter: (node) => node.nodeName === "LABEL" && node.parentElement?.getAttribute("data-type") === "taskItem",
  replacement: () => "",
});

const cellText = (cell: Element): string =>
  turndown
    .turndown((cell as HTMLElement).innerHTML)
    .replace(/\n+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();

turndown.addRule("table", {
  filter: (node) => node.nodeName === "TABLE" && isSimpleTable(node as HTMLElement),
  replacement: (_content, node) => {
    const rows = Array.from((node as HTMLElement).querySelectorAll("tr")).map((row) => Array.from(row.children).map(cellText));
    const width = Math.max(...rows.map((row) => row.length));
    const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, index) => cells[index] ?? "").join(" | ")} |`;
    const [head, ...body] = rows;
    return `\n\n${[line(head), line(Array(width).fill("---")), ...body.map(line)].join("\n")}\n\n`;
  },
});

export function htmlToMarkdown(html: string): string {
  const root = inertRoot(html);
  root.id = "classic-root";
  // An editor with nothing typed holds one empty paragraph.
  if (!root.textContent?.trim() && !root.querySelector("img, hr, table, input, .wpc-columns")) return "";
  return turndown.turndown(root).trim();
}
