import { describe, expect, it, vi } from "vitest";
import { htmlToMarkdown, markdownToHtml } from "@/components/MemoEditor/edit/classic/markdown";
import { allowedStyle } from "@/lib/html-sanitize-schema";
import { sanitizeMemoHtml } from "@/lib/sanitized-html";

const roundTrip = (markdown: string) => htmlToMarkdown(markdownToHtml(markdown));

const renderHtml = (source: string): string => {
  const template = document.createElement("template");
  template.innerHTML = source;
  const element = document.createElement("div");
  element.append(sanitizeMemoHtml(template.content));
  return element.innerHTML;
};

describe("classic editor Markdown round trip", () => {
  it.each([
    ["a paragraph with a tag", "Hello #work/planning and #idea"],
    ["a tag at the start of a line", "#todo buy milk"],
    ["headings", "# Title\n\n## Section\n\nBody"],
    ["emphasis", "**bold** *italic* ~~gone~~ `code`"],
    ["a link", "See [memos](https://usememos.com)"],
    ["a bullet list", "- one\n- two\n- three"],
    ["a numbered list", "1. one\n2. two"],
    ["a checklist", "- [ ] open\n- [x] done"],
    ["a quote", "> quoted"],
    ["a code block", "```js\nconst a = 1;\n```"],
    ["a divider", "above\n\n---\n\nbelow"],
    ["an image", "![cat](/file/attachments/abc123)"],
    ["a simple table", "| a | b |\n| --- | --- |\n| 1 | 2 |"],
    ["line breaks", "line one\nline two"],
  ])("keeps %s", (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("returns an empty memo for an empty document", () => {
    expect(htmlToMarkdown("<p></p>")).toBe("");
  });
});

describe("classic editor formatting Markdown cannot express", () => {
  it("stores a centered heading as one HTML block and reads it back", () => {
    const markdown = htmlToMarkdown('<h2 style="text-align: center">Lịch sử</h2><p>Body #tag</p>');
    expect(markdown).toBe('<h2 style="text-align: center">Lịch sử</h2>\n\nBody #tag');
    expect(markdownToHtml(markdown)).toContain('<h2 style="text-align: center">Lịch sử</h2>');
  });

  it("stores colored, sized text in a paragraph as HTML", () => {
    const html = '<p>Plain <span style="color: #dc2626; font-size: 24px; font-family: Georgia, serif">big red</span> <u>under</u></p>';
    const markdown = htmlToMarkdown(html);
    expect(markdown.startsWith("<p>")).toBe(true);
    expect(markdown).toContain("font-size: 24px");
    expect(markdown).toContain("<u>under</u>");
    expect(markdown).not.toContain("\n");
  });

  it("stores columns as one HTML block without blank lines", () => {
    const html =
      '<div class="wpc-columns wpc-cols-2"><div class="wpc-column"><p>Left</p></div><div class="wpc-column"><p>Right</p><pre><code>a\n\nb</code></pre></div></div>';
    const markdown = htmlToMarkdown(html);
    expect(markdown).not.toMatch(/\n/);
    expect(markdown).toContain('class="wpc-columns wpc-cols-2"');
    expect(markdownToHtml(markdown)).toContain('<div class="wpc-column"><p>Left</p></div>');
  });
});

describe("memo view sanitization of classic formatting", () => {
  it("keeps the classic editor's styles and column classes", () => {
    const html = renderHtml(
      '<div class="wpc-columns wpc-cols-3 evil"><div class="wpc-column"><h2 style="text-align: center">T</h2><p><span style="color: #dc2626; background-color: #fde68a; font-family: \'Courier New\', monospace; font-size: 18px">x</span> <u>u</u></p></div></div>',
    );
    expect(html).toContain('class="wpc-columns wpc-cols-3"');
    expect(html).toContain('style="text-align: center"');
    expect(html).toContain("color: #dc2626");
    expect(html).toContain("font-size: 18px");
    expect(html).toContain("<u>u</u>");
    expect(html).not.toContain("evil");
  });

  it("drops style properties and values outside the allowlist", () => {
    expect(allowedStyle("position: fixed; inset: 0")).toBeNull();
    expect(allowedStyle("color: red; position: fixed")).toBe("color: red");
    expect(allowedStyle("background-color: url(https://tracker.example/a.png)")).toBeNull();
    expect(allowedStyle("font-family: expression(alert(1))")).toBeNull();
    expect(allowedStyle("color: red\\;")).toBeNull();
  });
});

describe("classic editor HTML safety", () => {
  it("drops handlers, scripts and javascript: links from Markdown's raw HTML", () => {
    const html = markdownToHtml(
      '<img src="x" onerror="alert(1)">\n\n<script>alert(2)</script>\n\n[go](javascript:alert(3))\n\n<p style="text-align:center">ok</p>',
    );
    expect(html).not.toMatch(/onerror|<script|javascript:/i);
    expect(html).toContain('<img src="x">');
    expect(html).toContain("text-align:center");
  });

  it("never loads what the HTML points at while converting", () => {
    const created = vi.spyOn(document, "createElement");
    markdownToHtml('<img src="https://attacker.example/x.png" onerror="alert(1)">');
    htmlToMarkdown('<p><img src="https://attacker.example/y.png"></p>');
    // Every element is built in a separate document, never in the page's own.
    expect(created).not.toHaveBeenCalled();
    created.mockRestore();
  });
});

describe("pasted HTML (fork)", () => {
  it("drops the source's colors, fonts and styles but keeps the structure", async () => {
    const { cleanPastedHtml } = await import("@/components/MemoEditor/edit/classic/markdown");
    const html = cleanPastedHtml(
      '<h2 style="color:red" class="x">Tiêu đề</h2><p><font color="#f00" face="Comic Sans">đỏ</font> <span style="background:yellow;font-size:30px">vàng</span> <b style="color:blue">đậm</b> <a href="https://x.vn" style="color:green" target="_blank">link</a></p><ul><li style="color:red">một</li></ul>',
    );
    expect(html).toBe('<h2>Tiêu đề</h2><p>đỏ vàng <b>đậm</b> <a href="https://x.vn">link</a></p><ul><li>một</li></ul>');
  });
});
