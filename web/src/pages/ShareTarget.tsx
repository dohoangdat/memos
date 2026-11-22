import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Spinner } from "@usememos/ui";
import { FilePlus2Icon, LinkIcon, SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MemoEditor } from "@/components/MemoEditor";
import { useLinkMemo } from "@/components/MemoEditor/edit/hooks";
import RelativeTime from "@/components/RelativeTime";
import { memoServiceClient } from "@/connect";
import { useBackToClose } from "@/hooks/useBackToClose";
import { memoSummary } from "@/lib/list-density";
import { OFFLINE_MEMO_PREFIX } from "@/lib/offline/outbox";
import { toast } from "@/lib/toast";
import { ROUTES } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";
import { buildSharedMemoContent, sharedLink } from "@/utils/share-target";

type Step = { kind: "choose" } | { kind: "new" } | { kind: "append"; name: string };

/** The composer step of the share flow; Android's Back closes the share (fork). */
const ShareEditorStep = ({ onClose, children }: { onClose: () => void; children: React.ReactNode }) => {
  useBackToClose(onClose);
  return <>{children}</>;
};

/** How long the shared page may take to describe itself before the memo goes without it. */
const METADATA_TIMEOUT_MS = 6000;

/**
 * The installed app's share target (see `share_target` in site.webmanifest): another app's
 * share sheet opens `/share?title=…&text=…&url=…`.
 *
 * Fork: adding to a memo you already have comes first, as a compact list of your recent memos
 * with a search field; a new memo is the secondary choice. The shared link's page title and
 * description are fetched (through the server, MemoService.GetLinkMetadata) and written into the
 * memo, which makes tagging easier. The full composer then opens with the result; saving opens
 * the memo, and Back at any point closes the share.
 */
const ShareTarget = () => {
  const t = useTranslate();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const shared = { title: params.get("title"), text: params.get("text"), url: params.get("url") };
  const link = sharedLink(shared);
  const metadata = useQuery({
    queryKey: ["share-link-metadata", link],
    enabled: Boolean(link),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: ({ signal }) =>
      memoServiceClient.getLinkMetadata({ url: link }, { signal: AbortSignal.any([signal, AbortSignal.timeout(METADATA_TIMEOUT_MS)]) }),
  });
  const content = buildSharedMemoContent(shared, metadata.data);
  const fetchingPage = Boolean(link) && metadata.isLoading;

  const recent = useLinkMemo({
    isOpen: step.kind === "choose",
    currentMemoName: undefined,
    existingRelations: [],
    onAddRelation: () => undefined,
  });

  useEffect(() => {
    if (!buildSharedMemoContent(shared)) navigate(ROUTES.HOME, { replace: true });
  }, [shared.title, shared.text, shared.url, navigate]);

  const leave = () => navigate(ROUTES.HOME, { replace: true });
  const saved = (memoName: string) => {
    toast.add({ title: t("share-target.saved"), type: "success" });
    // Replace /share so Back never offers to share the same thing again. A memo saved offline
    // has no page until it syncs, so the feed shows it waiting instead.
    navigate(memoName.startsWith(OFFLINE_MEMO_PREFIX) ? ROUTES.HOME : `/${memoName}`, { replace: true });
  };

  if (!content) return null;

  if (step.kind !== "choose") {
    return (
      <ShareEditorStep onClose={leave}>
        <MemoEditor
          {...(step.kind === "append" ? { mode: "edit" as const, name: step.name } : { draft: { scope: "share" } })}
          autoFocus
          seedContent={content}
          placeholder={t("editor.any-thoughts")}
          onConfirm={step.kind === "append" ? () => saved(step.name) : saved}
          onCancel={leave}
          onFocusModeExit={leave}
        />
      </ShareEditorStep>
    );
  }

  const pageTitle = metadata.data?.title || shared.title || link;
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-3 px-3 py-3">
      <div className="flex items-start gap-2 rounded-mu-lg border border-mu-line bg-mu-surface px-3 py-2">
        <LinkIcon className="mt-0.5 mu-icon-sm shrink-0 text-mu-text-secondary" />
        <div className="min-w-0 flex-1">
          <p className="truncate mu-label text-mu-text">{pageTitle || t("share-target.title")}</p>
          <p className="truncate mu-caption text-mu-text-secondary">
            {fetchingPage ? t("share-target.fetching") : metadata.data?.description || link || shared.text}
          </p>
        </div>
        {fetchingPage && <Spinner />}
      </div>

      <h1 className="mu-label text-mu-text">{t("share-target.append")}</h1>
      <Input
        value={recent.searchText}
        onChange={(event) => recent.setSearchText(event.target.value)}
        prefix={<SearchIcon />}
        placeholder={t("share-target.search")}
        aria-label={t("share-target.search")}
      />
      <ul className="flex max-h-[55svh] flex-col overflow-y-auto rounded-mu-lg border border-mu-line bg-mu-surface">
        {recent.filteredMemos.map((memo) => {
          const { title, description } = memoSummary(memo.content);
          return (
            <li key={memo.name} className="border-b border-mu-line/60 last:border-b-0">
              <button
                type="button"
                disabled={fetchingPage}
                onClick={() => setStep({ kind: "append", name: memo.name })}
                className="flex w-full min-w-0 flex-col gap-0.5 border border-transparent px-3 py-2 text-start hover:bg-mu-hover mu-focus disabled:opacity-60"
              >
                <span className="flex w-full min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate mu-body text-mu-text">{title || t("memo.untitled")}</span>
                  <span className="shrink-0 mu-caption text-mu-text-secondary">
                    <RelativeTime date={memo.updateTime ? timestampDate(memo.updateTime) : undefined} />
                  </span>
                </span>
                {description && <span className="w-full truncate mu-caption text-mu-text-secondary">{description}</span>}
              </button>
            </li>
          );
        })}
        {recent.isFetching && recent.filteredMemos.length === 0 && (
          <li className="flex justify-center py-4">
            <Spinner />
          </li>
        )}
        {!recent.isFetching && recent.filteredMemos.length === 0 && (
          <li className="px-3 py-4 mu-caption text-mu-text-secondary">{t("share-target.no-match")}</li>
        )}
      </ul>

      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={leave}>
          {t("common.cancel")}
        </Button>
        <Button variant="neutral" icon={<FilePlus2Icon />} disabled={fetchingPage} onClick={() => setStep({ kind: "new" })}>
          {t("share-target.new-memo")}
        </Button>
      </div>
    </section>
  );
};

export default ShareTarget;
