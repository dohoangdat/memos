import { Button, Menu, Tooltip } from "@usememos/ui";
import { HashIcon, ListTreeIcon, MoreHorizontalIcon, PencilIcon } from "lucide-react";
import { forwardRef, useMemo, useState } from "react";
import { TagRenameDialog } from "@/components/TagRename/TagRenameDialog";
import { useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { useLocalStorage, useOverflowTitle } from "@/hooks";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import TagTree, { tagRowAriaLabel } from "../TagTree";
import {
  SIDEBAR_ROW_BOX_CLASSES,
  SIDEBAR_ROW_COUNT_RAIL_CLASSES,
  SIDEBAR_ROW_LABEL_CLASSES,
  SIDEBAR_TAG_SELECTED_CLASSES,
  SidebarRowIconSlot,
  sidebarRowEditButtonClasses,
  sidebarRowStateAttributes,
  sidebarRowStateClasses,
} from "./SidebarRow";
import SidebarSection from "./SidebarSection";

interface Props {
  tagCount: Record<string, number>;
  onSelect?: () => void;
  /** Whose tags these are; keeps tree expansion state from bleeding between users and views. */
  scope: string;
  /** Offers a quick rename on each tag (the current user's own tags). */
  canRename?: boolean;
}

const TagPath = forwardRef<HTMLSpanElement, { tag: string }>(({ tag }, ref) => {
  const segments = tag.split("/");

  return (
    <span ref={ref} className="min-w-0 flex-1 truncate text-start">
      {segments.map((segment, index) => (
        <span key={`${segment}-${index}`}>
          {index > 0 && <span className="px-0.5 text-mu-text-secondary/40">/</span>}
          <span className={index === segments.length - 1 ? "text-current" : "text-mu-text-secondary/75"}>{segment}</span>
        </span>
      ))}
    </span>
  );
});
TagPath.displayName = "TagPath";

interface FlatTagRowProps {
  tag: string;
  amount: number;
  active: boolean;
  /** Computed by the parent, which already holds the translator — rows stay subscription-free. */
  ariaLabel: string;
  renameLabel?: string;
  onClick: () => void;
  onRename?: () => void;
}

const FlatTagRow = ({ tag, amount, active, ariaLabel, renameLabel, onClick, onRename }: FlatTagRowProps) => {
  const { ref, title } = useOverflowTitle<HTMLSpanElement>(`#${tag}`);
  const state = active ? "checked" : "idle";

  return (
    <div
      {...sidebarRowStateAttributes(state)}
      className={cn(SIDEBAR_ROW_BOX_CLASSES, sidebarRowStateClasses(state), active && SIDEBAR_TAG_SELECTED_CLASSES)}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-pressed={active || undefined}
        title={title}
        className={SIDEBAR_ROW_LABEL_CLASSES}
        onClick={onClick}
      >
        {/* Same leading slot as the tree, so the # marks hold their line when switching modes. */}
        <SidebarRowIconSlot icon={HashIcon} />
        <TagPath ref={ref} tag={tag} />
        <span className={SIDEBAR_ROW_COUNT_RAIL_CLASSES}>{amount}</span>
      </button>
      {onRename && (
        <button
          type="button"
          aria-label={`${renameLabel} #${tag}`}
          title={renameLabel}
          className={sidebarRowEditButtonClasses(active)}
          onClick={onRename}
        >
          <PencilIcon className="mu-icon-xs" />
        </button>
      )}
    </div>
  );
};

const TagsSection = ({ tagCount, onSelect, scope, canRename = false }: Props) => {
  const t = useTranslate();
  const [renaming, setRenaming] = useState<string | null>(null);
  const handleRename = canRename ? (tag: string) => setRenaming(tag) : undefined;
  const { getFiltersByFactor, addFilter, removeFilter } = useMemoFilterContext();
  const [treeMode, setTreeMode] = useLocalStorage<boolean>("tag-view-as-tree", false);
  const activeTags = new Set(getFiltersByFactor("tagSearch").map((filter) => filter.value));
  const activeTag = activeTags.values().next().value as string | undefined;
  const tags = useMemo(() => Object.entries(tagCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])), [tagCount]);

  if (tags.length === 0) {
    return null;
  }

  const handleTagClick = (tag: string) => {
    const active = activeTags.has(tag);
    if (active) {
      removeFilter((filter) => filter.factor === "tagSearch" && filter.value === tag);
    } else {
      removeFilter((filter) => filter.factor === "tagSearch");
      addFilter({ factor: "tagSearch", value: tag });
    }
    onSelect?.();
  };

  return (
    <SidebarSection
      collapseId="tags"
      label={t("common.tags")}
      action={
        <Menu.Root modal={false} size="md">
          <Tooltip.Root>
            <Tooltip.Trigger
              render={
                <Menu.Trigger
                  aria-label={`${t("common.tags")}: ${t("common.more")}`}
                  render={<Button variant="ghost" size="xs" icon={<MoreHorizontalIcon />} />}
                />
              }
            />
            <Tooltip.Popup side="top">{t("common.more")}</Tooltip.Popup>
          </Tooltip.Root>
          <Menu.Popup align="end">
            <Menu.Group>
              <Menu.GroupLabel>{t("common.tags")}</Menu.GroupLabel>
              <Menu.CheckboxItem checked={treeMode} onCheckedChange={setTreeMode} closeOnClick icon={<ListTreeIcon />}>
                {t("common.tree-mode")}
              </Menu.CheckboxItem>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Root>
      }
    >
      {treeMode ? (
        <TagTree key={scope} tagAmounts={tags} activeTag={activeTag} scope={scope} onTagClick={handleTagClick} onRename={handleRename} />
      ) : (
        <>
          {tags.map(([tag, amount]) => (
            <FlatTagRow
              key={tag}
              tag={tag}
              amount={amount}
              active={activeTags.has(tag)}
              ariaLabel={tagRowAriaLabel(t, tag, amount)}
              renameLabel={t("tag-rename.action")}
              onClick={() => handleTagClick(tag)}
              onRename={handleRename && (() => handleRename(tag))}
            />
          ))}
        </>
      )}
      {canRename && <TagRenameDialog tag={renaming} onClose={() => setRenaming(null)} />}
    </SidebarSection>
  );
};

export default TagsSection;
