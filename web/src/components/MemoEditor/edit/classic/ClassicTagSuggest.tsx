import type { Editor } from "@tiptap/react";
import { HashIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useOrderedTags } from "@/hooks/useTagOrder";
import { useTagCounts } from "@/hooks/useUserQueries";
import { cn } from "@/lib/utils";

const MAX_ITEMS = 8;
/** `#` and the tag being typed, right before the caret. */
const TYPED_TAG = /(?:^|\s)#([\p{L}\p{N}\p{M}_&+\-/]*)$/u;

interface Typed {
  query: string;
  from: number;
  to: number;
  left: number;
  top: number;
}

/**
 * Tag suggestions while typing `#…` in the classic editor (fork): the user's tags that match
 * (those starting with what was typed first, then those containing it, most used first). Arrow
 * keys move, Enter or Tab picks, Escape closes; a tap picks too. Picking writes `#tag `.
 */
export const ClassicTagSuggest = ({ editor }: { editor: Editor }) => {
  const { data: counts = {} } = useTagCounts(true);
  const ordered = useOrderedTags(counts);
  const [typed, setTyped] = useState<Typed | null>(null);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  useEffect(() => {
    const read = () => {
      const { state, view } = editor;
      const { selection } = state;
      if (!selection.empty || !editor.isFocused) return setTyped(null);
      const $from = selection.$from;
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
      const match = before.match(TYPED_TAG);
      if (!match) return setTyped(null);
      const to = selection.from;
      const from = to - match[1].length - 1;
      const coords = view.coordsAtPos(to);
      setTyped({ query: match[1], from, to, left: coords.left, top: coords.bottom });
    };
    const close = () => setTimeout(() => setTyped(null), 150);
    editor.on("selectionUpdate", read);
    editor.on("update", read);
    editor.on("blur", close);
    return () => {
      editor.off("selectionUpdate", read);
      editor.off("update", read);
      editor.off("blur", close);
    };
  }, [editor]);

  const items = useMemo(() => {
    if (!typed) return [];
    const query = typed.query.toLowerCase();
    const starts = ordered.filter(([tag]) => tag.toLowerCase().startsWith(query));
    const contains = ordered.filter(([tag]) => !tag.toLowerCase().startsWith(query) && tag.toLowerCase().includes(query));
    return [...starts, ...contains].filter(([tag]) => tag.toLowerCase() !== query).slice(0, MAX_ITEMS);
  }, [typed, ordered]);

  const open = Boolean(typed) && items.length > 0 && dismissedAt !== typed?.from;

  useEffect(() => setActive(0), [typed?.query]);

  const pick = (tag: string) => {
    if (!typed) return;
    editor.chain().focus().insertContentAt({ from: typed.from, to: typed.to }, `#${tag} `).run();
    setTyped(null);
  };

  // Keys reach this listener before the editor's own (capture phase) while the list is open.
  useEffect(() => {
    if (!open) return;
    const dom = editor.view.dom;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setActive((index) => (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
      } else if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        pick(items[active][0]);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissedAt(typed?.from ?? null);
      }
    };
    dom.addEventListener("keydown", onKey, true);
    return () => dom.removeEventListener("keydown", onKey, true);
  });

  if (!open || !typed) return null;
  const width = 240;
  const left = Math.max(8, Math.min(typed.left, window.innerWidth - width - 8));
  return createPortal(
    <div
      role="listbox"
      aria-label="Tags"
      className="fixed z-(--mu-layer-popup) max-h-64 overflow-y-auto rounded-mu-md border border-mu-line bg-mu-surface p-1 shadow-lg"
      style={{ left, top: typed.top + 4, width }}
    >
      {items.map(([tag, count], index) => (
        <button
          key={tag}
          type="button"
          role="option"
          aria-selected={index === active}
          // Keep the editor's focus and caret: the list must not take focus.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => pick(tag)}
          className={cn(
            "flex w-full items-center gap-1.5 rounded-mu-sm px-2 py-1.5 text-start mu-body text-mu-text",
            index === active ? "bg-mu-hover" : "hover:bg-mu-hover/60",
          )}
        >
          <HashIcon className="mu-icon-xs shrink-0 text-mu-text-secondary" />
          <span className="min-w-0 flex-1 truncate">{tag}</span>
          <span className="shrink-0 mu-caption tabular-nums text-mu-text-secondary">{count}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
};
