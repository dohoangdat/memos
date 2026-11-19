import { Button, Dialog, Input } from "@usememos/ui";
import { HashIcon, SearchIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import TagTree from "@/components/TagTree";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { useBackToClose } from "@/hooks/useBackToClose";
import { useOrderedTags } from "@/hooks/useTagOrder";
import { useTagCounts } from "@/hooks/useUserQueries";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";

/** The sheet's body: mounted only while open, so Back closes it and nothing runs otherwise. */
const TagFilterPanel = ({ onClose }: { onClose: () => void }) => {
  const t = useTranslate();
  const { data: tagCounts = {} } = useTagCounts(true);
  const { getFiltersByFactor, addFilter, removeFilter } = useMemoFilterContext();
  const activeTag = getFiltersByFactor("tagSearch")[0]?.value;
  const [query, setQuery] = useState("");
  useBackToClose(onClose);
  const ordered = useOrderedTags(tagCounts);
  const needle = query.trim().replace(/^#/, "").toLowerCase();
  const matches = useMemo(() => (needle ? ordered.filter(([tag]) => tag.toLowerCase().includes(needle)) : []), [ordered, needle]);

  const pick = (tag: string) => {
    removeFilter((filter) => filter.factor === "tagSearch");
    if (tag !== activeTag) addFilter({ factor: "tagSearch", value: tag });
    onClose();
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          prefix={<SearchIcon />}
          placeholder={t("tag-filter.search")}
          aria-label={t("tag-filter.search")}
          className="min-w-0 flex-1"
        />
        {activeTag && (
          <Button variant="neutral" icon={<XIcon />} onClick={() => pick(activeTag)}>
            {t("tag-filter.clear")}
          </Button>
        )}
      </div>
      <div className="mt-3 max-h-[60dvh] overflow-y-auto">
        {needle ? (
          <ul className="flex flex-col gap-0.5">
            {matches.map(([tag, count]) => (
              <li key={tag}>
                <button
                  type="button"
                  onClick={() => pick(tag)}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-2 rounded-mu-md border border-transparent px-2 text-start mu-body mu-focus hover:bg-mu-hover",
                    tag === activeTag && "bg-mu-primary/10",
                  )}
                >
                  <HashIcon className="mu-icon-sm text-mu-text-secondary" />
                  <span className="min-w-0 flex-1 truncate">{tag}</span>
                  <span className="mu-caption text-mu-text-secondary tabular-nums">{count}</span>
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="px-2 py-3 mu-caption text-mu-text-secondary">{t("tag-filter.none")}</li>}
          </ul>
        ) : (
          <TagTree tagAmounts={ordered} activeTag={activeTag} scope="tag-filter-sheet" onTagClick={pick} />
        )}
      </div>
    </>
  );
};

/**
 * The mobile header's tag filter: a # button showing the tag in use; it opens a sheet with the
 * tag tree (in the order set in tag management) and a search field. Picking the active tag again
 * clears the filter.
 */
const TagFilterSheet = () => {
  const t = useTranslate();
  const { getFiltersByFactor } = useMemoFilterContext();
  const activeTag = getFiltersByFactor("tagSearch")[0]?.value;
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={activeTag ? "neutral" : "ghost"}
        icon={<HashIcon />}
        aria-label={activeTag ? `${t("tag-filter.title")}: #${activeTag}` : t("tag-filter.title")}
        onClick={() => setOpen(true)}
        className={cn("ms-auto max-w-[45%]", activeTag && "bg-mu-primary/10")}
      >
        {activeTag && <span className="truncate">{activeTag.split("/").pop()}</span>}
      </Button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Popup className="w-lg max-w-[calc(100vw-1rem)]">
          <Dialog.Title>{t("tag-filter.title")}</Dialog.Title>
          {open && <TagFilterPanel onClose={() => setOpen(false)} />}
        </Dialog.Popup>
      </Dialog.Root>
    </>
  );
};

export default TagFilterSheet;
