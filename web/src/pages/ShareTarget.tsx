import { Button } from "@usememos/ui";
import { FilePlus2Icon, ListPlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MemoEditor } from "@/components/MemoEditor";
import { useLinkMemo } from "@/components/MemoEditor/edit/hooks";
import { LinkMemoDialog } from "@/components/MemoMetadata";
import { useBackToClose } from "@/hooks/useBackToClose";
import { toast } from "@/lib/toast";
import { ROUTES } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";
import { buildSharedMemoContent } from "@/utils/share-target";

type Step = { kind: "choose" } | { kind: "new" } | { kind: "append"; name: string };

/** One editing step of the share flow; Android's Back returns to the choice. */
const ShareEditorStep = ({ onBack, children }: { onBack: () => void; children: React.ReactNode }) => {
  useBackToClose(onBack);
  return <>{children}</>;
};

/**
 * The installed app's share target (see `share_target` in site.webmanifest): another app's
 * share sheet opens `/share?title=…&text=…&url=…`. The user picks a new memo or an existing one
 * to add to; either way the full composer opens with the shared text in it (tags, audience,
 * attachments, Cancel and Save as when writing any memo), and saving opens the memo.
 */
const ShareTarget = () => {
  const t = useTranslate();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [picking, setPicking] = useState(false);
  const content = buildSharedMemoContent({ title: params.get("title"), text: params.get("text"), url: params.get("url") });

  const linkMemo = useLinkMemo({
    isOpen: picking,
    currentMemoName: undefined,
    existingRelations: [],
    onAddRelation: (relation) => {
      const name = relation.relatedMemo?.name;
      if (!name) return;
      setPicking(false);
      setStep({ kind: "append", name });
    },
  });

  useEffect(() => {
    if (!content) navigate(ROUTES.HOME, { replace: true });
  }, [content, navigate]);

  const leave = () => navigate(ROUTES.HOME, { replace: true });
  const backToChoice = () => setStep({ kind: "choose" });
  const saved = (memoName: string) => {
    toast.add({ title: t("share-target.saved"), type: "success" });
    // Replace /share so Back never offers to share the same thing again.
    navigate(`/${memoName}`, { replace: true });
  };

  if (!content) return null;

  if (step.kind === "new") {
    return (
      <ShareEditorStep onBack={backToChoice}>
        <MemoEditor
          autoFocus
          draft={{ scope: "share" }}
          seedContent={content}
          placeholder={t("editor.any-thoughts")}
          onConfirm={saved}
          onCancel={backToChoice}
          onFocusModeExit={backToChoice}
        />
      </ShareEditorStep>
    );
  }

  if (step.kind === "append") {
    return (
      <ShareEditorStep onBack={backToChoice}>
        <MemoEditor
          mode="edit"
          name={step.name}
          autoFocus
          seedContent={content}
          onConfirm={() => saved(step.name)}
          onCancel={backToChoice}
          onFocusModeExit={backToChoice}
        />
      </ShareEditorStep>
    );
  }

  return (
    <section className="mx-auto flex min-h-[70svh] w-full max-w-xl flex-col justify-center gap-4 px-4 py-6">
      <h1 className="mu-heading text-mu-text">{t("share-target.title")}</h1>
      <pre className="max-h-56 overflow-auto rounded-mu-lg border border-mu-line bg-mu-surface px-3 py-2 font-sans mu-body whitespace-pre-wrap break-words text-mu-text-secondary">
        {content}
      </pre>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="primary" size="md" className="min-h-12" icon={<FilePlus2Icon />} onClick={() => setStep({ kind: "new" })}>
          {t("share-target.new-memo")}
        </Button>
        <Button variant="neutral" size="md" className="min-h-12" icon={<ListPlusIcon />} onClick={() => setPicking(true)}>
          {t("share-target.append")}
        </Button>
      </div>
      <Button variant="ghost" onClick={leave}>
        {t("common.cancel")}
      </Button>

      <LinkMemoDialog
        open={picking}
        onOpenChange={setPicking}
        searchText={linkMemo.searchText}
        onSearchChange={linkMemo.setSearchText}
        filteredMemos={linkMemo.filteredMemos}
        isFetching={linkMemo.isFetching}
        onSelectMemo={linkMemo.addMemoRelation}
        isAlreadyLinked={() => false}
      />
    </section>
  );
};

export default ShareTarget;
