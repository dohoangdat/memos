import { forwardRef, memo, Suspense, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { ensurePasskey, requestPasskey } from "@/components/Passkey/passkeyPrompt";
import { useAuth } from "@/contexts/AuthContext";
import { useResolvedUser } from "@/contexts/MentionResolutionContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useDenseList } from "@/lib/list-density";
import { isLockedContent, setSessionKey } from "@/lib/memo-crypto";
import { isMemoBlurred } from "@/lib/tag";
import { cn } from "@/lib/utils";
import { State } from "@/types/proto/api/common_pb";
import { lazyWithReload } from "@/utils/lazy";
import { canManageMemo } from "@/utils/user";
import { MemoBody, MemoCommentListView, MemoHeader } from "./components";
import DenseMemoRow from "./components/DenseMemoRow";
import MemoPinnedMark from "./components/MemoPinnedMark";
import { MEMO_CARD_BASE_CLASSES } from "./constants";
import { useImagePreview } from "./hooks";
import { computeCommentAmount, MemoViewContext } from "./MemoViewContext";
import { isMemoDetailPath, resolveMemoParentPage } from "./navigation";
import type { MemoViewHandle, MemoViewProps } from "./types";

const MemoShareImageDialog = lazyWithReload(() => import("../MemoActionMenu/MemoShareImageDialog"));
const PreviewImageDialog = lazyWithReload(() => import("../PreviewImageDialog"));
const MemoReaderDialog = lazyWithReload(() => import("./MemoFullscreen").then((module) => ({ default: module.MemoReaderDialog })));
const MemoEditDialog = lazyWithReload(() => import("./MemoFullscreen").then((module) => ({ default: module.MemoEditDialog })));

/** Parts of a card that act on their own: a click there never opens the memo. */
const INTERACTIVE_SELECTOR =
  'a, button, input, textarea, select, label, summary, video, audio, img, iframe, [role="button"], [role="menuitem"], [role="checkbox"], [contenteditable="true"], [data-memo-no-open]';

/** Whether a pointer event started inside the card's own DOM (not a portal) on a plain part of it. */
const isPlainCardTarget = (event: React.MouseEvent<HTMLElement>): boolean => {
  const target = event.target as Element;
  if (!event.currentTarget.contains(target)) return false;
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  return !interactive || !event.currentTarget.contains(interactive);
};

/** How long a click waits for a second one before it opens the reader instead of the editor. */
const DOUBLE_CLICK_WAIT_MS = 250;

const MemoView = forwardRef<MemoViewHandle, MemoViewProps>((props, ref) => {
  const {
    memo: memoData,
    className,
    parentPage: parentPageProp,
    compact,
    timeDisplay,
    showCreator,
    showVisibility,
    showPinned,
    showSpace,
    presentation = "card",
  } = props;
  const cardRef = useRef<HTMLDivElement>(null);
  // A memo is read and edited full screen, never in place: the card only ever shows its preview.
  const [overlay, setOverlay] = useState<"read" | "edit" | null>(null);
  const isEditing = false;
  const [cardWidth, setCardWidth] = useState(0);

  const currentUser = useCurrentUser();
  const { userTagsSetting } = useAuth();
  const creator = useResolvedUser(memoData.creator, { enabled: Boolean(showCreator || props.shareImageDialogOpen) });
  const isArchived = memoData.state === State.ARCHIVED;
  const readonly = !canManageMemo(memoData, currentUser);
  const location = useLocation();
  const parentPage = resolveMemoParentPage({
    explicitParentPage: parentPageProp,
    pathname: location.pathname,
    search: location.search,
    memoName: memoData.name,
  });

  // Blur content when any tag has blur_content enabled in the current user's tag settings.
  // The detail page controls the reveal so the sidebar outline can follow it.
  const [localShowBlurredContent, setLocalShowBlurredContent] = useState(false);
  const blurControlled = props.showBlurredContent !== undefined;
  const showBlurredContent = props.showBlurredContent ?? localShowBlurredContent;
  const onShowBlurredContentChange = props.onShowBlurredContentChange;
  const blurred = isMemoBlurred(memoData, userTagsSetting);
  const toggleBlurVisibility = useCallback(() => {
    const next = !showBlurredContent;
    if (!blurControlled) {
      setLocalShowBlurredContent(next);
    }
    onShowBlurredContentChange?.(next);
  }, [blurControlled, onShowBlurredContentChange, showBlurredContent]);

  const { previewState, openPreview, setPreviewOpen } = useImagePreview();

  // A locked memo asks for the passkey every time it is opened (to read or edit), and closing it
  // forgets the key again, so an unattended screen never reopens it. Inside the reader the memo
  // is already open: its Edit reuses the key, and the reader's own closing forgets it.
  const locked = isLockedContent(memoData.content);
  const insideReader = presentation === "reader";
  const openOverlay = useCallback(
    (next: "read" | "edit") => {
      if (!locked) {
        setOverlay(next);
        return;
      }
      void (insideReader ? ensurePasskey() : requestPasskey()).then((key) => key && setOverlay(next));
    },
    [locked, insideReader],
  );
  const openEditor = useCallback(() => openOverlay("edit"), [openOverlay]);
  const closeEditor = useCallback(() => {
    setOverlay(null);
    if (locked && !insideReader) setSessionKey(null);
  }, [locked, insideReader]);
  const handleFocusModeChange = useCallback(() => {}, []);

  // A click on a list's card reads the memo; a double click (or Edit) edits it. On a mouse the
  // first click waits briefly for a second; a tap opens the reader at once.
  const readerEnabled = presentation === "card" && Boolean(compact);
  const denseList = useDenseList();
  const clickTimerRef = useRef<number | undefined>(undefined);
  const pointerTypeRef = useRef<string>("mouse");
  useEffect(() => () => window.clearTimeout(clickTimerRef.current), []);
  const handleCardClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (!readerEnabled || event.detail > 1 || !isPlainCardTarget(event)) return;
      if (window.getSelection()?.toString()) return;
      window.clearTimeout(clickTimerRef.current);
      if (readonly || pointerTypeRef.current !== "mouse") {
        openOverlay("read");
        return;
      }
      clickTimerRef.current = window.setTimeout(() => openOverlay("read"), DOUBLE_CLICK_WAIT_MS);
    },
    [readerEnabled, readonly, openOverlay],
  );
  const handleCardDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (readonly || !isPlainCardTarget(event)) return;
      window.clearTimeout(clickTimerRef.current);
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
      openOverlay("edit");
    },
    [readonly, openOverlay],
  );
  const handleCardKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (readerEnabled && event.key === "Enter" && event.target === event.currentTarget) {
        event.preventDefault();
        openOverlay("read");
      }
    },
    [readerEnabled, openOverlay],
  );

  useImperativeHandle(ref, () => ({ openEditor }), [openEditor]);

  const isInMemoDetailPage = isMemoDetailPath(location.pathname, memoData.name);
  const showCommentPreview = !isInMemoDetailPage && computeCommentAmount(memoData) > 0;

  // The card width is only needed by the share-image dialog. Keep feed cards
  // free of a permanent ResizeObserver and measure only while that dialog is open.
  useLayoutEffect(() => {
    if (!props.shareImageDialogOpen) {
      return;
    }

    const card = cardRef.current;
    if (!card) {
      return;
    }

    const updateWidth = (nextWidth?: number) => {
      const width = Math.round(nextWidth ?? card.getBoundingClientRect().width);
      setCardWidth((prev) => (prev === width ? prev : width));
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      const handleResize = () => updateWidth();
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }

    const resizeObserver = new ResizeObserver((entries) => {
      updateWidth(entries[0]?.contentRect.width);
    });

    resizeObserver.observe(card);
    return () => resizeObserver.disconnect();
  }, [props.shareImageDialogOpen]);

  const contextValue = useMemo(
    () => ({
      memo: memoData,
      creator,
      currentUser,
      parentPage,
      cardWidth,
      isArchived,
      readonly,
      showBlurredContent,
      blurred,
      isEditing,
      openEditor,
      closeEditor,
      onEditorFocusModeChange: handleFocusModeChange,
      toggleBlurVisibility,
      openPreview,
    }),
    [
      memoData,
      creator,
      currentUser,
      parentPage,
      cardWidth,
      isArchived,
      readonly,
      showBlurredContent,
      blurred,
      isEditing,
      openEditor,
      closeEditor,
      handleFocusModeChange,
      toggleBlurVisibility,
      openPreview,
    ],
  );

  const dense = denseList && readerEnabled && !isEditing;
  const article = (
    <article
      className={cn(
        MEMO_CARD_BASE_CLASSES,
        "group/memo",
        dense && "py-2!",
        showCommentPreview && !dense ? "mb-0 rounded-b-none" : dense ? "mb-1" : "mb-2",
        readerEnabled && "cursor-pointer",
        className,
      )}
      ref={cardRef}
      tabIndex={readonly && !readerEnabled ? -1 : 0}
      onPointerDown={(event) => {
        pointerTypeRef.current = event.pointerType;
      }}
      onClick={handleCardClick}
      onDoubleClick={handleCardDoubleClick}
      onKeyDown={handleCardKeyDown}
    >
      {dense ? (
        // Compact list (fork): two lines per memo; opening and editing work as on a card.
        <DenseMemoRow memo={memoData} readonly={readonly} parentPage={parentPage} showPinned={showPinned} index={props.listIndex} />
      ) : (
        <>
          {/* The pinned mark steps aside while the memo is edited in place. */}
          {showPinned && memoData.pinned && !isEditing && <MemoPinnedMark />}
          <MemoHeader timeDisplay={timeDisplay} showCreator={showCreator} showVisibility={showVisibility} showSpace={showSpace} />

          <MemoBody compact={compact} showCreator={showCreator} />
        </>
      )}

      {previewState.items.length > 0 && (
        <Suspense fallback={null}>
          <PreviewImageDialog
            open={previewState.open}
            onOpenChange={setPreviewOpen}
            items={previewState.items}
            initialIndex={previewState.index}
            drawingContext={{ memo: memoData, canEdit: !readonly }}
          />
        </Suspense>
      )}

      {props.onShareImageDialogOpenChange && props.shareImageDialogOpen && (
        <Suspense fallback={null}>
          <MemoShareImageDialog open onOpenChange={props.onShareImageDialogOpenChange} />
        </Suspense>
      )}
    </article>
  );

  const memoDisplay =
    showCommentPreview && !dense ? (
      <div className="w-full mb-2">
        {article}
        <MemoCommentListView />
      </div>
    ) : (
      article
    );

  return (
    <MemoViewContext.Provider value={contextValue}>
      {memoDisplay}
      {overlay === "read" && (
        <Suspense fallback={null}>
          <MemoReaderDialog
            memo={memoData}
            viewProps={{ parentPage: parentPageProp, timeDisplay, showCreator, showVisibility, showSpace }}
            canEdit={!readonly}
            onClose={closeEditor}
          />
        </Suspense>
      )}
      {overlay === "edit" && (
        <Suspense fallback={null}>
          <MemoEditDialog name={memoData.name} lockedContent={locked ? memoData.content : undefined} onClose={closeEditor} />
        </Suspense>
      )}
    </MemoViewContext.Provider>
  );
});

MemoView.displayName = "MemoView";

export default memo(MemoView);
