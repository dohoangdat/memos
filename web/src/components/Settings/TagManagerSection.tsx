import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@usememos/ui";
import { ArrowDownAZIcon, ArrowDownWideNarrowIcon, GripVerticalIcon, HashIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useMemo, useRef, useState } from "react";
import { TagRenameDialog } from "@/components/TagRename/TagRenameDialog";
import { buildTagTree } from "@/components/TagTree";
import { memoKeys } from "@/hooks/useMemoQueries";
import { orderTags, useSaveTagOrder, useTagOrder } from "@/hooks/useTagOrder";
import { userKeys, useTagCounts } from "@/hooks/useUserQueries";
import { forkFetch } from "@/lib/fork-api";
import { showErrorToast, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import SettingSection from "./SettingSection";

type Node = ReturnType<typeof buildTagTree>[number];

/** The tree's tags, parents before their children, as the saved order. */
const flatten = (nodes: readonly Node[]): string[] => nodes.flatMap((node) => [node.text, ...flatten(node.subTags)]);

const move = <T,>(items: readonly T[], from: number, to: number): T[] => {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

/**
 * Siblings in one level of the tree, reordered by dragging a row's handle (mouse or touch) or
 * with the arrow keys on the handle. A row moves only among its siblings.
 */
const SortableLevel = ({
  nodes,
  depth,
  onReorder,
  renderRow,
}: {
  nodes: Node[];
  depth: number;
  onReorder: (nodes: Node[]) => void;
  renderRow: (node: Node, handle: React.ReactNode, depth: number) => React.ReactNode;
}) => {
  const t = useTranslate();
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const [drag, setDrag] = useState<{ index: number; startY: number; dy: number; target: number } | null>(null);

  const targetFor = (index: number, pointerY: number) => {
    let target = index;
    rows.current.forEach((row, other) => {
      if (!row || other === index) return;
      const box = row.getBoundingClientRect();
      const middle = box.top + box.height / 2;
      if (other < index && pointerY < middle) target = Math.min(target, other);
      if (other > index && pointerY > middle) target = Math.max(target, other);
    });
    return target;
  };

  const onPointerDown = (index: number) => (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ index, startY: event.clientY, dy: 0, target: index });
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    setDrag({ ...drag, dy: event.clientY - drag.startY, target: targetFor(drag.index, event.clientY) });
  };
  const onPointerUp = () => {
    if (drag && drag.target !== drag.index) onReorder(move(nodes, drag.index, drag.target));
    setDrag(null);
  };
  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLButtonElement>) => {
    const to = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : -1;
    if (to < 0 || to >= nodes.length) return;
    event.preventDefault();
    onReorder(move(nodes, index, to));
  };

  return (
    <ul className="flex flex-col gap-0.5">
      {nodes.map((node, index) => {
        const dragging = drag?.index === index;
        const handle = (
          <button
            type="button"
            aria-label={`${t("tag-manager.move")} #${node.text}`}
            title={t("tag-manager.move-hint")}
            className="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-mu-md border border-transparent text-mu-text-secondary hover:bg-mu-hover mu-focus active:cursor-grabbing"
            onPointerDown={onPointerDown(index)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={onKeyDown(index)}
          >
            <GripVerticalIcon className="mu-icon-sm" />
          </button>
        );
        return (
          <li
            key={node.text}
            ref={(element) => {
              rows.current[index] = element;
            }}
            className={cn(
              "relative",
              dragging && "z-10 rounded-mu-md bg-mu-surface shadow-lg",
              drag && !dragging && drag.target === index && "outline-2 outline-dashed outline-mu-primary/40 rounded-mu-md",
            )}
            style={dragging ? { transform: `translateY(${drag.dy}px)` } : undefined}
          >
            {renderRow(node, handle, depth)}
            {node.subTags.length > 0 && (
              <SortableLevel
                nodes={node.subTags}
                depth={depth + 1}
                onReorder={(subTags) => onReorder(nodes.map((item) => (item === node ? { ...node, subTags } : item)))}
                renderRow={renderRow}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
};

/**
 * Tag management: the user's tags as a tree in their own order, which the sidebar and the tag
 * filter follow. Drag a tag (or use the arrow keys on its handle) to move it among its siblings;
 * rename or delete it across all memos.
 */
const TagManagerSection = () => {
  const t = useTranslate();
  const queryClient = useQueryClient();
  const { data: tagCounts = {} } = useTagCounts(true);
  const { data: order = [] } = useTagOrder();
  const saveOrder = useSaveTagOrder();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const tree = useMemo(() => buildTagTree(orderTags(tagCounts, order)), [tagCounts, order]);

  const save = (nodes: Node[]) => saveOrder.mutate(flatten(nodes), { onError: () => showErrorToast(t("common.error-occurred")) });
  const sortBy = (compare: (a: Node, b: Node) => number) => {
    const sortLevel = (nodes: Node[]): Node[] => [...nodes].sort(compare).map((node) => ({ ...node, subTags: sortLevel(node.subTags) }));
    save(sortLevel(tree));
  };
  const total = (node: Node): number => (node.amount ?? 0) + node.subTags.reduce((sum, child) => sum + total(child), 0);

  const remove = async (tag: string) => {
    if (!window.confirm(t("tag-manager.delete-confirm", { tag, n: tagCounts[tag] ?? 0 }))) return;
    setDeleting(tag);
    try {
      const { updated } = await forkFetch<{ updated: string[] }>("/api/x/tags/delete", { method: "POST", body: { tag } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: memoKeys.all }),
        queryClient.invalidateQueries({ queryKey: userKeys.stats() }),
        queryClient.invalidateQueries({ queryKey: ["tag-order"] }),
      ]);
      toast.add({ title: t("tag-manager.deleted", { n: updated.length }), type: "success" });
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t("common.error-occurred"));
    } finally {
      setDeleting(null);
    }
  };

  const renderRow = (node: Node, handle: React.ReactNode, depth: number) => (
    <div className="flex min-h-10 items-center gap-1 rounded-mu-md pe-1 hover:bg-mu-hover/50" style={{ paddingInlineStart: depth * 20 }}>
      {handle}
      <HashIcon className="mu-icon-xs shrink-0 text-mu-text-secondary" />
      <span className="min-w-0 flex-1 truncate mu-body text-mu-text">{node.key}</span>
      <span className="shrink-0 mu-caption tabular-nums text-mu-text-secondary">{node.amount ?? ""}</span>
      <Button
        variant="ghost"
        size="sm"
        icon={<PencilIcon />}
        aria-label={`${t("tag-rename.action")} #${node.text}`}
        onClick={() => setRenaming(node.text)}
      />
      <Button
        variant="ghost"
        size="sm"
        icon={<Trash2Icon />}
        aria-label={`${t("tag-manager.delete")} #${node.text}`}
        disabled={deleting !== null}
        loading={deleting === node.text}
        onClick={() => void remove(node.text)}
      />
    </div>
  );

  return (
    <SettingSection title={t("tag-manager.title")} description={t("tag-manager.description")}>
      <div className="flex flex-wrap gap-2">
        <Button variant="neutral" size="sm" icon={<ArrowDownAZIcon />} onClick={() => sortBy((a, b) => a.key.localeCompare(b.key))}>
          {t("tag-manager.sort-name")}
        </Button>
        <Button
          variant="neutral"
          size="sm"
          icon={<ArrowDownWideNarrowIcon />}
          onClick={() => sortBy((a, b) => total(b) - total(a) || a.key.localeCompare(b.key))}
        >
          {t("tag-manager.sort-count")}
        </Button>
      </div>
      {tree.length === 0 ? (
        <p className="mu-caption text-mu-text-secondary">{t("tag-manager.empty")}</p>
      ) : (
        <SortableLevel nodes={tree} depth={0} onReorder={save} renderRow={renderRow} />
      )}
      <TagRenameDialog tag={renaming} onClose={() => setRenaming(null)} />
    </SettingSection>
  );
};

export default TagManagerSection;
