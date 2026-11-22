import { timestampDate } from "@bufbuild/protobuf/wkt";
import { EyeOffIcon, LockKeyholeIcon, PinIcon } from "lucide-react";
import MemoActionMenu from "@/components/MemoActionMenu";
import RelativeTime from "@/components/RelativeTime";
import { useMemoProtectionMode } from "@/hooks/useMemoProtection";
import { useBlurAll } from "@/lib/blur-all";
import { memoSummary } from "@/lib/list-density";
import { isLockedContent } from "@/lib/memo-crypto";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { getAttachmentThumbnailUrl } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";

/** The memo's first image: an attached image, else an image in its text. */
const memoThumbnail = (memo: Memo): string | undefined => {
  const attached = memo.attachments.find((attachment) => attachment.type.startsWith("image/"));
  if (attached) return getAttachmentThumbnailUrl(attached);
  return memo.content.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+|\/[^)\s]+)/)?.[1];
};

/**
 * A memo as a compact two-line row (fork): the title and when it was last changed, then a short
 * description. A blurred or locked memo shows its title only.
 */
const DenseMemoRow = ({
  memo,
  readonly,
  parentPage,
  showPinned,
  index,
}: {
  memo: Memo;
  readonly: boolean;
  parentPage?: string;
  showPinned?: boolean;
  /** The memo's place in the list from 1. */
  index?: number;
}) => {
  const t = useTranslate();
  const protection = useMemoProtectionMode(memo.name);
  const blurAll = useBlurAll();
  const locked = isLockedContent(memo.content);
  const hidden = locked || protection === "blur" || blurAll;
  const { title, description } = memoSummary(memo.content);
  const updated = memo.updateTime ? timestampDate(memo.updateTime) : undefined;
  const thumbnail = hidden ? undefined : memoThumbnail(memo);
  return (
    // The card lays its children out from the start; the row stretches so long text truncates
    // at the screen's edge instead of widening the card.
    <div className="flex w-full min-w-0 items-center gap-3 self-stretch">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          {index ? <span className="shrink-0 mu-caption tabular-nums text-mu-text-secondary">{index}.</span> : null}
          {showPinned && memo.pinned && <PinIcon className="mu-icon-xs shrink-0 text-mu-text-secondary" />}
          <span className="min-w-0 flex-1 truncate mu-label text-mu-text">{title || t("memo.untitled")}</span>
          <span className="shrink-0 mu-caption text-mu-text-secondary">
            <RelativeTime date={updated} />
          </span>
          <span className="-me-1 shrink-0">
            <MemoActionMenu memo={memo} readonly={readonly} parentPage={parentPage} />
          </span>
        </div>
        <p className="flex min-h-[2lh] min-w-0 items-start gap-1 mu-caption text-mu-text-secondary">
          {hidden ? (
            <>
              {locked ? <LockKeyholeIcon className="mu-icon-xs" /> : <EyeOffIcon className="mu-icon-xs" />}
              {locked ? t("protect.locked-hint") : t("protect.blurred-hint")}
            </>
          ) : (
            <span className="line-clamp-2 min-w-0 break-words">{description || "\u00a0"}</span>
          )}
        </p>
      </div>
      {thumbnail && (
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="size-11 shrink-0 rounded-mu-md border border-mu-line object-cover"
        />
      )}
    </div>
  );
};

export default DenseMemoRow;
