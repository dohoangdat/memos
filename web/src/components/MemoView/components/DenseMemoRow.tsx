import { timestampDate } from "@bufbuild/protobuf/wkt";
import { EyeOffIcon, LockKeyholeIcon, PinIcon } from "lucide-react";
import MemoActionMenu from "@/components/MemoActionMenu";
import RelativeTime from "@/components/RelativeTime";
import { useMemoProtectionMode } from "@/hooks/useMemoProtection";
import { useBlurAll } from "@/lib/blur-all";
import { memoSummary } from "@/lib/list-density";
import { isLockedContent } from "@/lib/memo-crypto";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

/**
 * A memo as a compact two-line row (fork): the title and when it was last changed, then a short
 * description. A blurred or locked memo shows its title only.
 */
const DenseMemoRow = ({
  memo,
  readonly,
  parentPage,
  showPinned,
}: {
  memo: Memo;
  readonly: boolean;
  parentPage?: string;
  showPinned?: boolean;
}) => {
  const t = useTranslate();
  const protection = useMemoProtectionMode(memo.name);
  const blurAll = useBlurAll();
  const locked = isLockedContent(memo.content);
  const hidden = locked || protection === "blur" || blurAll;
  const { title, description } = memoSummary(memo.content);
  const updated = memo.updateTime ? timestampDate(memo.updateTime) : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-2">
        {showPinned && memo.pinned && <PinIcon className="mu-icon-xs shrink-0 text-mu-text-secondary" />}
        <span className="min-w-0 flex-1 truncate mu-label text-mu-text">{title || t("memo.untitled")}</span>
        <span className="shrink-0 mu-caption text-mu-text-secondary">
          <RelativeTime date={updated} />
        </span>
        <span className="-me-1 shrink-0">
          <MemoActionMenu memo={memo} readonly={readonly} parentPage={parentPage} />
        </span>
      </div>
      <p className="flex min-w-0 items-center gap-1 truncate mu-caption text-mu-text-secondary">
        {hidden ? (
          <>
            {locked ? <LockKeyholeIcon className="mu-icon-xs" /> : <EyeOffIcon className="mu-icon-xs" />}
            {locked ? t("protect.locked-hint") : t("protect.blurred-hint")}
          </>
        ) : (
          <span className="truncate">{description || " "}</span>
        )}
      </p>
    </div>
  );
};

export default DenseMemoRow;
