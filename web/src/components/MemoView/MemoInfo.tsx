import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Button } from "@usememos/ui";
import {
  BarChart3Icon,
  ChevronRightIcon,
  ClockIcon,
  EyeIcon,
  FileTextIcon,
  HashIcon,
  HistoryIcon,
  ImageIcon,
  RotateCcwIcon,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useLocalStorage } from "@/hooks";
import { type MemoRevision, useMemoRevisions, useRestoreMemoRevision } from "@/hooks/useMemoRevisions";
import { showErrorToast, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { type DiffLine, diffLines, diffStat, withContext } from "@/utils/line-diff";
import { filterInlineManagedAttachments } from "@/utils/managed-attachment";
import { computeMemoStats, formatBytes, type MemoStats } from "@/utils/memo-stats";

export { countMemoOpen } from "@/utils/memo-opens";

/** How many earlier versions the panel offers to restore. */
const RECENT_REVISIONS = 3;

/** The memo's tags without the ancestors the server adds: `a/b` stands for `a` too. */
const leafTags = (tags: readonly string[]) => tags.filter((tag) => !tags.some((other) => other.startsWith(`${tag}/`)));

const useMemoStats = (memo: Memo): MemoStats =>
  useMemo(() => {
    const attachedImages = filterInlineManagedAttachments(memo.content, memo.attachments).filter((attachment) =>
      attachment.type.startsWith("image/"),
    ).length;
    return computeMemoStats(memo.content, attachedImages);
  }, [memo.content, memo.attachments]);

const formatTime = (value: Date | string | undefined) =>
  value ? new Date(value).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—";

const Fact = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap">
    {icon}
    {children}
  </span>
);

/** The reader's top line: the few numbers worth a glance. Tags already show in the memo itself. */
export const MemoInfoSummary = ({ memo, opens }: { memo: Memo; opens: number }) => {
  const t = useTranslate();
  const stats = useMemoStats(memo);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 mu-caption text-mu-text-secondary">
      <Fact icon={<FileTextIcon className="mu-icon-xs" />}>{t("memo-info.words", { n: stats.words.toLocaleString() })}</Fact>
      {stats.readingMinutes > 0 && (
        <Fact icon={<ClockIcon className="mu-icon-xs" />}>{t("memo-info.reading-time", { n: stats.readingMinutes })}</Fact>
      )}
      {stats.images > 0 && <Fact icon={<ImageIcon className="mu-icon-xs" />}>{t("memo-info.images-count", { n: stats.images })}</Fact>}
      <Fact icon={<EyeIcon className="mu-icon-xs" />}>{t("memo-info.opens-count", { n: opens })}</Fact>
    </div>
  );
};

/** A section of the info panel that folds; whether it is open is remembered on this device. */
const Section = ({
  id,
  icon,
  title,
  aside,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) => {
  const [open, setOpen] = useLocalStorage<boolean>(`memo-info-open:${id}`, false);
  return (
    <div className="border-b border-mu-line last:border-b-0">
      <button
        type="button"
        aria-expanded={Boolean(open)}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-center gap-2 rounded-mu-md border border-transparent px-1 text-start mu-label text-mu-text mu-focus"
      >
        <ChevronRightIcon className={cn("mu-icon-sm shrink-0 text-mu-text-secondary transition-transform", open && "rotate-90")} />
        {icon}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {aside && <span className="shrink-0 mu-caption text-mu-text-secondary">{aside}</span>}
      </button>
      {open && <div className="pb-3 ps-1">{children}</div>}
    </div>
  );
};

/** The reader's foot: tags, statistics and the latest versions, each folding on its own. */
export const MemoInfoPanel = ({ memo, opens, canEdit }: { memo: Memo; opens: number; canEdit: boolean }) => {
  const t = useTranslate();
  const stats = useMemoStats(memo);
  const tags = leafTags(memo.tags);
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
  ];
  // Dates are long: each gets a full-width row so the label never truncates on a phone.
  const times: [string, string][] = [
    [t("memo-info.created"), formatTime(memo.createTime && timestampDate(memo.createTime))],
    [t("memo-info.updated"), formatTime(memo.updateTime && timestampDate(memo.updateTime))],
  ];

  return (
    <section aria-label={t("memo-info.title")} className="mt-4 flex flex-col border-t border-mu-line pt-2">
      {tags.length > 0 && (
        <Section
          id="tags"
          icon={<HashIcon className="mu-icon-sm text-mu-text-secondary" />}
          title={t("memo-info.tags")}
          aside={tags.length}
        >
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 rounded-mu-md bg-mu-well px-2 py-0.5 mu-caption text-mu-text-secondary"
              >
                <HashIcon className="mu-icon-xs opacity-60" />
                {tag}
              </span>
            ))}
          </div>
        </Section>
      )}
      <Section
        id="stats"
        icon={<BarChart3Icon className="mu-icon-sm text-mu-text-secondary" />}
        title={t("memo-info.stats")}
        aside={t("memo-info.words", { n: stats.words.toLocaleString() })}
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-0 sm:grid-cols-3">
          {rows.map(([label, value]) => (
            <div key={label} className="flex min-w-0 items-baseline justify-between gap-2 border-b border-mu-line/60 py-1.5">
              <dt className="min-w-0 truncate mu-caption text-mu-text-secondary">{label}</dt>
              <dd className="shrink-0 mu-caption text-mu-text tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <dl className="mt-1">
          {times.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 border-b border-mu-line/60 py-1.5">
              <dt className="mu-caption text-mu-text-secondary">{label}</dt>
              <dd className="mu-caption text-mu-text tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </Section>
      {canEdit && <MemoRevisionSection memo={memo} />}
    </section>
  );
};

const DiffStat = ({ added, removed }: { added: number; removed: number }) => (
  <span className="inline-flex gap-1.5 font-mono mu-caption tabular-nums">
    <span className="text-green-600 dark:text-green-400">+{added}</span>
    <span className="text-red-600 dark:text-red-400">−{removed}</span>
  </span>
);

const DiffView = ({ lines }: { lines: readonly DiffLine[] }) => {
  const t = useTranslate();
  const hunk = withContext(lines);
  return (
    <div className="max-h-72 overflow-auto border-t border-mu-line font-mono mu-caption">
      {hunk.map((line, index) =>
        line.type === "skip" ? (
          <div key={`skip-${index}`} className="bg-mu-well px-3 py-0.5 text-mu-text-secondary">
            {t("memo-info.unchanged-lines", { n: line.count })}
          </div>
        ) : (
          <div
            key={`${line.type}-${index}`}
            className={cn(
              "whitespace-pre-wrap break-words px-3",
              line.type === "add" && "bg-green-500/10 text-green-700 dark:text-green-300",
              line.type === "del" && "bg-red-500/10 text-red-700 dark:text-red-300",
              line.type === "same" && "text-mu-text-secondary",
            )}
          >
            <span aria-hidden className="me-2 select-none opacity-60">
              {line.type === "add" ? "+" : line.type === "del" ? "−" : " "}
            </span>
            {line.text || " "}
          </div>
        ),
      )}
    </div>
  );
};

/**
 * The latest edits, newest first, like `git log --stat`: each revision holds the text before an
 * edit, so that edit changed it into the next newer revision (or the current text). Viewing
 * shows the edit as a diff; restoring brings the earlier text back.
 */
const MemoRevisionSection = ({ memo }: { memo: Memo }) => {
  const t = useTranslate();
  const { data: revisions = [] } = useMemoRevisions(memo.name, true);
  const restore = useRestoreMemoRevision(memo.name);
  const [openId, setOpenId] = useState<number | null>(null);

  const edits = useMemo(
    () =>
      revisions.slice(0, RECENT_REVISIONS).map((revision, index) => {
        const after = index === 0 ? memo.content : revisions[index - 1].content;
        const lines = diffLines(revision.content, after);
        return { revision, lines, ...diffStat(lines) };
      }),
    [revisions, memo.content],
  );

  const handleRestore = async (revision: MemoRevision) => {
    if (!window.confirm(t("memo-info.restore-confirm", { time: formatTime(revision.createTime) }))) return;
    try {
      await restore.mutateAsync(revision);
      toast.add({ title: t("memo-info.restored"), type: "success" });
    } catch {
      showErrorToast(t("common.error-occurred"));
    }
  };

  return (
    <Section
      id="history"
      icon={<HistoryIcon className="mu-icon-sm text-mu-text-secondary" />}
      title={t("memo-info.history")}
      aside={revisions.length || undefined}
    >
      {edits.length === 0 ? (
        <p className="mu-caption text-mu-text-secondary">{t("memo-info.history-empty")}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {edits.map(({ revision, lines, added, removed }) => {
            const open = openId === revision.id;
            return (
              <li key={revision.id} className="overflow-hidden rounded-mu-md border border-mu-line">
                <div className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="mu-body text-mu-text">{formatTime(revision.createTime)}</span>
                    <DiffStat added={added} removed={removed} />
                  </div>
                  <div className="flex justify-end gap-1.5">
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
                </div>
                {open && <DiffView lines={lines} />}
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-2 mu-caption text-mu-text-secondary">{t("memo-info.history-note")}</p>
    </Section>
  );
};
