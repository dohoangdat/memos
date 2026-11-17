import { Button } from "@usememos/ui";
import { PinIcon, StarIcon } from "lucide-react";
import { useReactionActions } from "@/components/MemoReactionListView/hooks";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

/** A star is the viewer's own ⭐ reaction, so it uses the reactions memos already keeps. */
export const STAR_REACTION = "⭐";

/** On desktop an inactive action shows only while the card is engaged; an active one always shows. */
const restClasses = (active: boolean) => (active ? "" : "sm:hidden sm:group-hover/memo:inline-flex sm:group-focus-within/memo:inline-flex");

/** Pin (for whoever can manage the memo) and Star (for whoever can react), in place of the reaction picker. */
export const MemoQuickActions = ({ memo, canPin }: { memo: Memo; canPin: boolean }) => {
  const t = useTranslate();
  const { hasReacted, handleReactionClick, canReact, isPending } = useReactionActions({ memo });
  const { mutateAsync: updateMemo, isPending: isPinning } = useUpdateMemo(memo.name);
  const starred = hasReacted(STAR_REACTION);

  return (
    <>
      {canPin && (
        <Button
          variant="ghost"
          size="sm"
          className={restClasses(memo.pinned)}
          aria-pressed={memo.pinned}
          aria-label={memo.pinned ? t("common.unpin") : t("common.pin")}
          title={memo.pinned ? t("common.unpin") : t("common.pin")}
          disabled={isPinning}
          icon={<PinIcon className={cn(memo.pinned && "fill-current text-mu-text")} />}
          onClick={() => updateMemo({ update: { name: memo.name, pinned: !memo.pinned }, updateMask: ["pinned"] }).catch(() => undefined)}
        />
      )}
      {(canReact || starred) && (
        <Button
          variant="ghost"
          size="sm"
          className={restClasses(starred)}
          aria-pressed={starred}
          aria-label={starred ? t("memo.unstar") : t("memo.star")}
          title={starred ? t("memo.unstar") : t("memo.star")}
          disabled={isPending}
          icon={<StarIcon className={cn(starred && "fill-amber-400 text-amber-500")} />}
          onClick={() => handleReactionClick(STAR_REACTION)}
        />
      )}
    </>
  );
};
