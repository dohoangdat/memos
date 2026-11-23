import { HashIcon } from "lucide-react";
import { useMemoProtectionMode } from "@/hooks/useMemoProtection";
import { useBlurAll } from "@/lib/blur-all";
import { isLockedContent } from "@/lib/memo-crypto";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/memo_service_pb";

/** The memo's tags without the ancestors the server adds: `a/b` stands for `a` too. */
const leafTags = (tags: readonly string[]) => tags.filter((tag) => !tags.some((other) => other.startsWith(`${tag}/`)));

/**
 * The memo's tags in small type at the foot of a list item (fork), on cards and compact rows,
 * to see at a glance how a memo is filed. A blurred or locked memo keeps its tags hidden.
 */
const MemoTagLine = ({ memo, className }: { memo: Memo; className?: string }) => {
  const protection = useMemoProtectionMode(memo.name);
  const blurAll = useBlurAll();
  const tags = leafTags(memo.tags ?? []);
  if (tags.length === 0 || blurAll || protection === "blur" || isLockedContent(memo.content)) return null;
  return (
    <div className={cn("flex w-full min-w-0 flex-wrap gap-1", className)}>
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex max-w-full items-center gap-0.5 rounded-mu-sm bg-mu-well px-1.5 py-px mu-caption text-mu-text-secondary"
        >
          <HashIcon className="mu-icon-xs shrink-0 opacity-60" />
          <span className="truncate">{tag}</span>
        </span>
      ))}
    </div>
  );
};

export default MemoTagLine;
