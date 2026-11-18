import { EyeOffIcon, LockKeyholeIcon } from "lucide-react";
import { MemoContentView } from "@/components/MemoEditor/view/MemoContentView";
import { memoTitle } from "@/lib/memo-crypto";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";

/**
 * A protected memo in a list: only its `# Title` shows; the body, its tags and attachments
 * stay hidden behind a blurred stand-in, and a badge says why. Opening the card reads it
 * (asking for the passkey first when it is locked).
 */
const ProtectedPreview = ({ memo, mode, onUnlock }: { memo: Memo; mode: "blur" | "lock"; onUnlock?: () => void }) => {
  const t = useTranslate();
  const title = memoTitle(memo.content);
  const Icon = mode === "lock" ? LockKeyholeIcon : EyeOffIcon;
  return (
    <div className="flex w-full flex-col gap-2">
      {title && <MemoContentView content={title} memoName={memo.name} />}
      <div aria-hidden className="relative w-full select-none">
        <div className="flex flex-col gap-2 py-1 blur-[3px]">
          {[92, 78, 85, 60].map((width, index) => (
            <span key={index} className="h-3 rounded-full bg-mu-text-secondary/25" style={{ width: `${width}%` }} />
          ))}
        </div>
      </div>
      <span
        role={onUnlock ? "button" : undefined}
        onClick={onUnlock}
        className={cn(
          "inline-flex w-fit items-center gap-1.5 rounded-mu-md border border-mu-line bg-mu-well px-2 py-1 mu-caption text-mu-text-secondary",
          onUnlock && "cursor-pointer hover:text-mu-text",
        )}
      >
        <Icon className="mu-icon-xs" />
        {mode === "lock" ? t("protect.locked-hint") : t("protect.blurred-hint")}
      </span>
    </div>
  );
};

export default ProtectedPreview;
