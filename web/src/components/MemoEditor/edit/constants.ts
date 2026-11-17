export const FOCUS_MODE_STYLES = {
  backdrop: "fixed inset-0 bg-mu-overlay backdrop-blur-sm z-(--mu-layer-overlay)",
  container: {
    // Wide enough to write long memos; edge to edge on phones, clear of the notch and home bar.
    base: "fixed z-50 w-auto max-w-5xl mx-auto border-mu-line h-auto overflow-y-auto pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 max-sm:rounded-none max-sm:border-0",
    spacing: "inset-0 sm:top-4 sm:left-4 sm:right-4 sm:bottom-4 md:top-6 md:left-6 md:right-6 md:bottom-6",
  },
  /** The view transition name the session's frame carries while focus mode toggles (see editor.css). */
  transitionName: "memo-focus-mode",
} as const;
