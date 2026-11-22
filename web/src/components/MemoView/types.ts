import type { Memo } from "@/types/proto/api/memo_service_pb";

/** How the header names the memo's time: relative to now, or just the clock time for lists that already name the day. */
export type MemoTimeDisplay = "relative" | "time";

export interface MemoViewProps {
  /** The memo's place in a list from 1; the compact list shows it (fork). */
  listIndex?: number;
  memo: Memo;
  compact?: boolean;
  timeDisplay?: MemoTimeDisplay;
  showCreator?: boolean;
  showVisibility?: boolean;
  showPinned?: boolean;
  showSpace?: boolean;
  className?: string;
  parentPage?: string;
  shareImageDialogOpen?: boolean;
  onShareImageDialogOpenChange?: (open: boolean) => void;
  /** Controls whether tag-blurred content is revealed; uncontrolled when omitted. */
  showBlurredContent?: boolean;
  onShowBlurredContentChange?: (show: boolean) => void;
  /**
   * "card" (default): a click on a compact card opens the memo full screen to read, a double
   * click or Edit opens it full screen to edit. "reader": the memo inside that reader, where a
   * click does not open another one.
   */
  presentation?: "card" | "reader";
}

export interface MemoViewHandle {
  openEditor: () => void;
}

export interface MemoHeaderProps {
  timeDisplay?: MemoTimeDisplay;
  showCreator?: boolean;
  showVisibility?: boolean;
  showSpace?: boolean;
}

export interface MemoBodyProps {
  compact?: boolean;
  /** Mirrors the header's: while editing, the session's timestamp row leads with the creator. */
  showCreator?: boolean;
}
