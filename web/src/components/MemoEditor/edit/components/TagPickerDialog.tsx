import { Button, Dialog, Input } from "@usememos/ui";
import { CheckIcon, HashIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTagCounts } from "@/hooks/useUserQueries";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { addTagToMarkdown, hasTag, removeTagFromMarkdown } from "@/utils/memo-tags-markdown";
import { isCompleteTagValue } from "@/utils/tag-grammar";

interface TagPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The draft as Markdown, read when the picker opens and after each pick. */
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
}

/**
 * Picks tags without typing them: the user's tags as an indented tree with their counts,
 * filtered as you type. A click adds the tag to the memo's tag line (or removes it again);
 * a name that is not a tag yet can be created.
 */
export const TagPickerDialog = ({ open, onOpenChange, getMarkdown, setMarkdown }: TagPickerDialogProps) => {
  const t = useTranslate();
  const { data: tagCounts } = useTagCounts(true);
  const [query, setQuery] = useState("");
  const [markdown, setLocalMarkdown] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setLocalMarkdown(getMarkdown());
  }, [open, getMarkdown]);

  const tags = useMemo(() => Object.keys(tagCounts ?? {}).sort((a, b) => a.localeCompare(b)), [tagCounts]);
  const needle = query.trim().replace(/^#/, "").toLowerCase();
  const visible = needle ? tags.filter((tag) => tag.toLowerCase().includes(needle)) : tags;
  const newTag = query.trim().replace(/^#/, "");
  const canCreate = Boolean(newTag) && isCompleteTagValue(newTag) && !tags.includes(newTag);

  const toggle = (tag: string) => {
    const next = hasTag(markdown, tag) ? removeTagFromMarkdown(markdown, tag) : addTagToMarkdown(markdown, tag);
    setLocalMarkdown(next);
    setMarkdown(next);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Popup variant="bare" sheet={false} className="w-md max-w-[calc(100vw-1rem)]">
        <Dialog.Title className="mu-visually-hidden">{t("editor.insert-menu.add-tags")}</Dialog.Title>
        <div className="flex max-h-[80svh] flex-col">
          <div className="p-3">
            <Input
              aria-label={t("editor.tag-picker.search")}
              placeholder={t("editor.tag-picker.search")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canCreate) {
                  event.preventDefault();
                  toggle(newTag);
                  setQuery("");
                }
              }}
              autoFocus
            />
          </div>
          <div className="border-t border-mu-line" />
          <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1" aria-label={t("common.tags")}>
            {canCreate && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    toggle(newTag);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-start mu-body text-mu-text hover:bg-mu-hover/50"
                >
                  <PlusIcon className="mu-icon-sm shrink-0" />
                  {t("editor.tag-picker.create", { tag: newTag })}
                </button>
              </li>
            )}
            {visible.map((tag) => {
              const selected = hasTag(markdown, tag);
              const depth = needle ? 0 : tag.split("/").length - 1;
              return (
                <li key={tag}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(tag)}
                    className={cn(
                      "flex w-full min-h-10 items-center gap-2 py-2 pe-3 text-start mu-body hover:bg-mu-hover/50",
                      selected ? "text-mu-text" : "text-mu-text-secondary",
                    )}
                    style={{ paddingInlineStart: 12 + depth * 16 }}
                  >
                    {selected ? (
                      <CheckIcon className="mu-icon-sm shrink-0 text-mu-accent" />
                    ) : (
                      <HashIcon className="mu-icon-sm shrink-0 opacity-60" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{needle ? tag : tag.split("/").pop()}</span>
                    <span className="shrink-0 mu-caption text-mu-text-secondary">{tagCounts?.[tag]}</span>
                  </button>
                </li>
              );
            })}
            {!visible.length && !canCreate && (
              <li className="py-8 text-center mu-body text-mu-text-secondary">{t("editor.tag-picker.empty")}</li>
            )}
          </ul>
          <div className="flex justify-end border-t border-mu-line p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <Button variant="primary" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
          </div>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
};
