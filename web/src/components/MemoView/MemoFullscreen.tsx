import { Dialog } from "@base-ui/react/dialog";
import { Button } from "@usememos/ui";
import { ArrowLeftIcon, PencilIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { MemoEditor } from "@/components/MemoEditor";
import { PullToRefresh } from "@/components/PullToRefresh";
import { useBackToClose } from "@/hooks/useBackToClose";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { countMemoOpen, MemoInfoPanel, MemoInfoSummary } from "./MemoInfo";
import MemoView from "./MemoView";
import type { MemoViewHandle, MemoViewProps } from "./types";

/** What the full-screen reader passes on to the memo it shows. */
export type MemoReaderViewProps = Pick<MemoViewProps, "parentPage" | "timeDisplay" | "showCreator" | "showVisibility" | "showSpace">;

interface MemoReaderDialogProps {
  memo: Memo;
  viewProps: MemoReaderViewProps;
  canEdit: boolean;
  onClose: () => void;
}

/**
 * A memo opened from a list to read: full screen on phones (with the safe areas kept clear),
 * a large centered sheet from md. The memo shows uncut; its own Edit opens the full-screen
 * editor over this reader, and saving returns here.
 */
export const MemoReaderDialog = ({ memo, viewProps, canEdit, onClose }: MemoReaderDialogProps) => {
  const t = useTranslate();
  const viewRef = useRef<MemoViewHandle>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Android's Back closes the reader instead of leaving the app.
  useBackToClose(onClose);
  // Counted once per opening, on this device.
  const [opens] = useState(() => countMemoOpen(memo.name));

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-(--mu-layer-overlay) bg-mu-overlay backdrop-blur-sm" />
        <Dialog.Popup
          className="fixed inset-0 z-(--mu-layer-overlay) flex flex-col overflow-hidden bg-mu-canvas outline-none md:inset-6 md:mx-auto md:max-w-5xl md:rounded-mu-lg md:border md:border-mu-line md:shadow-xl"
          aria-modal="true"
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-mu-line px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-4">
            <Button variant="ghost" size="md" icon={<ArrowLeftIcon />} aria-label={t("common.close")} onClick={onClose} />
            <Dialog.Title className="mu-visually-hidden">{t("memo.read-memo")}</Dialog.Title>
            {canEdit && (
              <Button variant="neutral" size="md" icon={<PencilIcon />} className="ms-auto" onClick={() => viewRef.current?.openEditor()}>
                {t("common.edit")}
              </Button>
            )}
          </header>
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pt-5"
          >
            <PullToRefresh scrollRef={scrollRef} />
            <div className="mx-auto w-full max-w-3xl">
              <MemoInfoSummary memo={memo} opens={opens} />
              <MemoView ref={viewRef} memo={memo} {...viewProps} compact={false} presentation="reader" />
              <MemoInfoPanel memo={memo} opens={opens} canEdit={canEdit} />
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

interface MemoEditDialogProps {
  name: string;
  onClose: () => void;
}

/**
 * Editing a memo full screen: the memo editor's own focus-mode presentation, hosted in a
 * modal like the new-memo composer. An edit keeps no draft, so Escape and a press outside
 * do not dismiss it; only Save, Cancel or the editor's close button do, and never mid-save.
 */
export const MemoEditDialog = ({ name, onClose }: MemoEditDialogProps) => {
  const t = useTranslate();
  const savingRef = useRef(false);
  const requestClose = useCallback(() => {
    if (!savingRef.current) onClose();
  }, [onClose]);
  // Back closes the editor like its own close button (never mid-save).
  useBackToClose(requestClose);

  return (
    <Dialog.Root
      open
      onOpenChange={(open, details) => {
        if (open) return;
        if (savingRef.current || details.reason === "escape-key" || details.reason === "outside-press") {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-(--mu-layer-overlay) bg-transparent" />
        <Dialog.Popup className="fixed inset-0 z-(--mu-layer-overlay) outline-none" initialFocus aria-modal="true">
          <Dialog.Title className="mu-visually-hidden">{t("common.edit")}</Dialog.Title>
          <MemoEditor
            mode="edit"
            name={name}
            autoFocus
            onConfirm={onClose}
            onCancel={onClose}
            // Mounts in focus mode; leaving it closes this dialog.
            onFocusModeExit={requestClose}
            onSavingChange={(saving) => {
              savingRef.current = saving;
            }}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
