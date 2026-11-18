import { Button, Dialog, Field, Input } from "@usememos/ui";
import { PencilIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { useRenameTag } from "@/hooks/useRenameTag";
import { useTagCounts } from "@/hooks/useUserQueries";
import { showErrorToast, toast } from "@/lib/toast";
import { useTranslate } from "@/utils/i18n";
import { isCompleteTagValue } from "@/utils/tag-grammar";

interface Props {
  /** The tag to rename; the dialog is open while one is set. */
  tag: string | null;
  onClose: () => void;
}

/**
 * Renames a tag across all of the user's memos. Sub-tags move with it (`#a/x` → `#b/x`), and a
 * name that already exists merges the two tags. A tag filter that was on follows the new name.
 */
export const TagRenameDialog = ({ tag, onClose }: Props) => {
  const t = useTranslate();
  const { data: tagCounts = {} } = useTagCounts(true);
  const { getFiltersByFactor, addFilter, removeFilter } = useMemoFilterContext();
  const rename = useRenameTag();
  const [value, setValue] = useState("");

  useEffect(() => {
    if (tag) setValue(tag);
  }, [tag]);

  const next = value.trim().replace(/^#/, "");
  const valid = isCompleteTagValue(next);
  const changed = valid && next !== tag;
  const merges = changed && tagCounts[next] !== undefined;

  const submit = async () => {
    if (!tag || !changed || rename.isPending) return;
    try {
      const result = await rename.mutateAsync({ from: tag, to: next });
      // Keep a tag filter that was on, under its new name.
      const active = getFiltersByFactor("tagSearch").map((filter) => filter.value);
      const followed = active.find((value) => value === tag || value.startsWith(`${tag}/`));
      if (followed) {
        removeFilter((filter) => filter.factor === "tagSearch");
        addFilter({ factor: "tagSearch", value: next + followed.slice(tag.length) });
      }
      toast.add({ title: t("tag-rename.done", { n: result.updated }), type: "success" });
      if (result.lockedPending > 0) showErrorToast(t("tag-rename.locked-pending", { n: result.lockedPending }));
      onClose();
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t("common.error-occurred"));
    }
  };

  return (
    <Dialog.Root open={Boolean(tag)} onOpenChange={(open) => !open && !rename.isPending && onClose()}>
      <Dialog.Popup className="w-sm max-w-[calc(100vw-1rem)]">
        <Dialog.Title className="flex items-center gap-2">
          <PencilIcon className="mu-icon" />
          {t("tag-rename.title", { tag: tag ?? "" })}
        </Dialog.Title>
        <form
          className="mt-2 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field.Root invalid={Boolean(next) && !valid}>
            <Field.Label>{t("tag-rename.label")}</Field.Label>
            <Input
              autoFocus
              value={value}
              disabled={rename.isPending}
              onChange={(event) => setValue(event.target.value)}
              onFocus={(event) => event.target.select()}
            />
            {Boolean(next) && !valid && <Field.Error match>{t("tag-rename.invalid")}</Field.Error>}
          </Field.Root>
          <p className="mu-caption text-mu-text-secondary">
            {t("tag-rename.hint", { n: tag ? (tagCounts[tag] ?? 0) : 0, from: tag ?? "", to: changed ? next : "…" })}
          </p>
          {merges && <p className="mu-caption text-mu-text">{t("tag-rename.merge", { tag: next })}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="neutral" type="button" disabled={rename.isPending} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" type="submit" disabled={!changed || rename.isPending}>
              {t("tag-rename.action")}
            </Button>
          </div>
        </form>
      </Dialog.Popup>
    </Dialog.Root>
  );
};
