import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Button } from "@usememos/ui";
import { ClockIcon, EyeIcon, FileTextIcon, HashIcon, HistoryIcon, ImageIcon, RotateCcwIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useMemoRevisions, useRestoreMemoRevision } from "@/hooks/useMemoRevisions";
import { showErrorToast, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { filterInlineManagedAttachments } from "@/utils/managed-attachment";
import { computeMemoStats, formatBytes, type MemoStats } from "@/utils/memo-stats";

/** How many earlier versions the panel offers to restore. */
const RECENT_REVISIONS = 3;

// ---------------------------------------------------------------------------
// Opens: counted per device. memos keeps no view counts on the server.

const OPENS_KEY = "memos-open-counts";

const readOpens = (): Record<string, number> => {
  try {
    return JSON.parse(localStorage.getItem(OPENS_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
};

/** Counts one more open of a memo on this device and returns the new count. */
export const countMemoOpen = (memoName: string): number => {
  const opens = readOpens();
  opens[memoName] = (opens[memoName] ?? 0) + 1;
  try {
    localStorage.setItem(OPENS_KEY, JSON.stringify(opens));
  } catch {
    // Private mode or full storage: the count for this visit still shows.
  }
  return opens[memoName];
};

// ---------------------------------------------------------------------------

/** The memo's tags without the ancestors the server adds: `a/b` stands for `a` too. */
const leafTags = (tags: readonly string[]) => tags.filter((tag) => !tags.some((other) => other.startsWith(`${tag}/`)));

const useMemoStats = (memo: Memo): MemoStats =>
  useMemo(() => {
    const attachedImages = filterInlineManagedAttachments(memo.content, memo.attachments).filter((attachment) =>
      attachment.type.startsWith("image/"),
    ).length;
    return computeMemoStats(memo.content, attachedImages);
  }, [memo.content, memo.attachments]);

const TagChips = ({ tags }: { tags: readonly string[] }) => (
  <div className="flex flex-wrap gap-1.5">
    {leafTags(tags).map((tag) => (
      <span key={tag} className="inline-flex items-center gap-0.5 rounded-mu-md bg-mu-well px-2 py-0.5 mu-caption text-mu-text-secondary">
        <HashIcon className="size-3 opacity-60" />
        {tag}
      </span>
    ))}
  </div>
);

const Fact = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap [&_svg]:size-3.5">
    {icon}
    {children}
  </span>
);

/** The reader's top line: the memo's tags and the few numbers worth a glance. */
export const MemoInfoSummary = ({ memo, opens }: { memo: Memo; opens: number }) => {
  const t = useTranslate();
  const stats = useMemoStats(memo);
  return (
    <div className="mb-3 flex flex-col gap-2">
      {memo.tags.length > 0 && <TagChips tags={memo.tags} />}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mu-caption text-mu-text-secondary">
        <Fact icon={<FileTextIcon />}>{t("memo-info.words", { n: stats.words.toLocaleString() })}</Fact>
        {stats.readingMinutes > 0 && <Fact icon={<ClockIcon />}>{t("memo-info.reading-time", { n: stats.readingMinutes })}</Fact>}
        {stats.images > 0 && <Fact icon={<ImageIcon />}>{t("memo-info.images-count", { n: stats.images })}</Fact>}
        <Fact icon={<EyeIcon />}>{t("memo-info.opens-count", { n: opens })}</Fact>
      </div>
    </div>
  );
};

const formatTime = (value: Date | string | undefined) => (value ? new Date(value).toLocaleString() : "—");

/** The reader's foot: tags, full statistics, times and the latest versions to restore. */
export const MemoInfoPanel = ({ memo, opens, canEdit }: { memo: Memo; opens: number; canEdit: boolean }) => {
  const t = useTranslate();
  const stats = useMemoStats(memo);
  const rows: [string, ReactNode][] = [
    [t("memo-info.words-label"), stats.words.toLocaleString()],
    [t("memo-info.characters"), stats.characters.toLocaleString()],
    [t("memo-info.sentences"), stats.sentences],
    [t("memo-info.paragraphs"), stats.paragraphs],
    [t("memo-info.headings"), stats.headings],
    [t("memo-info.images"), stats.images],
    [t("memo-info.links"), stats.links],
    [t("memo-info.tasks"), stats.tasksTotal ? `${stats.tasksDone}/${stats.tasksTotal}` : 0],
    [t("memo-info.code-blocks"), stats.codeBlocks],
    [t("memo-info.reading-time-label"), t("memo-info.reading-time", { n: stats.readingMinutes })],
    [t("memo-info.size"), formatBytes(stats.bytes)],
    [t("memo-info.opens"), opens],
    [t("memo-info.created"), formatTime(memo.createTime && timestampDate(memo.createTime))],
    [t("memo-info.updated"), formatTime(memo.updateTime && timestampDate(memo.updateTime))],
  ];

  return (
    <section aria-label={t("memo-info.title")} className="mt-4 flex flex-col gap-4 border-t border-mu-line pt-4">
      {memo.tags.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="mu-label text-mu-text">{t("memo-info.tags")}</h3>
          <TagChips tags={memo.tags} />
        </div>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="mu-label text-mu-text">{t("memo-info.stats")}</h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {rows.map(([label, value]) => (
            <div key={label} className="flex min-w-0 items-baseline justify-between gap-2 border-b border-mu-line/60 py-1">
              <dt className="truncate mu-caption text-mu-text-secondary">{label}</dt>
              <dd className="shrink-0 mu-caption text-mu-text tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {canEdit && <MemoRevisionList memo={memo} />}
    </section>
  );
};

const MemoRevisionList = ({ memo }: { memo: Memo }) => {
  const t = useTranslate();
  const { data: revisions = [], isLoading } = useMemoRevisions(memo.name, true);
  const restore = useRestoreMemoRevision(memo.name);
  const [openId, setOpenId] = useState<number | null>(null);
  const currentSize = new TextEncoder().encode(memo.content).length;
  const recent = revisions.slice(0, RECENT_REVISIONS);

  const handleRestore = async (revision: (typeof revisions)[number]) => {
    if (!window.confirm(t("memo-info.restore-confirm", { time: formatTime(revision.createTime) }))) return;
    try {
      await restore.mutateAsync(revision);
      toast.add({ title: t("memo-info.restored"), type: "success" });
    } catch {
      showErrorToast(t("common.error-occurred"));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 mu-label text-mu-text">
        <HistoryIcon className="size-4" />
        {t("memo-info.history")}
      </h3>
      {isLoading ? null : recent.length === 0 ? (
        <p className="mu-caption text-mu-text-secondary">{t("memo-info.history-empty")}</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {recent.map((revision) => {
            const delta = revision.sizeBytes - currentSize;
            const open = openId === revision.id;
            return (
              <li key={revision.id} className="rounded-mu-md border border-mu-line">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="mu-body text-mu-text">{formatTime(revision.createTime)}</span>
                    <span className="mu-caption text-mu-text-secondary">
                      {formatBytes(revision.sizeBytes)} · {delta === 0 ? "±0" : `${delta > 0 ? "+" : "−"}${formatBytes(Math.abs(delta))}`}
                    </span>
                  </div>
                  <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpenId(open ? null : revision.id)}>
                    {open ? t("memo-info.hide") : t("memo-info.view")}
                  </Button>
                  <Button
                    variant="neutral"
                    size="sm"
                    icon={<RotateCcwIcon />}
                    disabled={restore.isPending || revision.content === memo.content}
                    onClick={() => handleRestore(revision)}
                  >
                    {t("memo-info.restore")}
                  </Button>
                </div>
                {open && (
                  <pre
                    className={cn(
                      "max-h-72 overflow-auto border-t border-mu-line px-3 py-2",
                      "mu-caption whitespace-pre-wrap break-words text-mu-text",
                    )}
                  >
                    {revision.content}
                  </pre>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p className="mu-caption text-mu-text-secondary">{t("memo-info.history-note")}</p>
    </div>
  );
};
