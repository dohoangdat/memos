/** The tag every memo created from the system share sheet carries. */
export const SHARED_MEMO_TAG = "chia-se";

export interface SharedData {
  title?: string | null;
  text?: string | null;
  url?: string | null;
}

const URL_PATTERN = /https?:\/\/[^\s<>"]+/;

/** Hashtags in shared text (#fyp, #xuhuong…) stay text, so they do not become memo tags. */
const escapeHashtags = (value: string) => value.replace(/(^|\s)#(?=\S)/g, "$1\\#");

/**
 * The memo for what another app shared (Web Share Target): the title in bold, the text, and the
 * link on its own line so the memo view shows it as a preview card, then SHARED_MEMO_TAG.
 * Apps differ in what goes where: many put the link inside `text` and leave `url` empty, or
 * repeat the link or the title, so the link is pulled out and repeats are dropped.
 * Returns "" when nothing was shared.
 */
export function buildSharedMemoContent({ title, text, url }: SharedData): string {
  let heading = (title ?? "").trim();
  let body = (text ?? "").trim();
  let link = (url ?? "").trim();

  if (!link) {
    const found = body.match(URL_PATTERN);
    if (found) link = found[0];
  }
  if (link)
    body = body
      .split(link)
      .join(" ")
      .replace(/[ \t]+/g, " ")
      .trim();
  if (heading && heading === link) heading = "";
  if (body && body === heading) body = "";

  const parts = [heading && `**${escapeHashtags(heading)}**`, body && escapeHashtags(body), link].filter(Boolean);
  if (!parts.length) return "";
  return [...parts, `#${SHARED_MEMO_TAG}`].join("\n\n");
}
