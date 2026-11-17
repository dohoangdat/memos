import { useEffect, useRef } from "react";

const OVERLAY_KEY = "__memoOverlay";
let nextOverlayId = 0;

/**
 * Makes the browser's (and Android's) Back close a full-screen overlay instead of leaving the
 * page or the installed app. While mounted, the overlay owns one history entry on top of the
 * current one (same URL, same router state); Back pops it and calls `onClose`. Closing the
 * overlay any other way removes that entry again, so history never fills with stale steps.
 * Overlays stack: Back closes the topmost one first.
 */
export function useBackToClose(onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const id = ++nextOverlayId;
    const current = window.history.state;
    window.history.pushState({ ...(current && typeof current === "object" ? current : {}), [OVERLAY_KEY]: id }, "");
    let poppedByBack = false;

    const handlePopState = () => {
      if (window.history.state?.[OVERLAY_KEY] === id) return;
      // Our entry is gone. If it is still further up the stack (Forward), this was not ours to close.
      poppedByBack = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (!poppedByBack && window.history.state?.[OVERLAY_KEY] === id) window.history.back();
    };
  }, []);
}
