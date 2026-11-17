import { type RefObject, useEffect } from "react";

/**
 * Keeps a full-screen editor clear of the on-screen keyboard. Android Chrome shrinks the layout
 * viewport itself (`interactive-widget=resizes-content` in index.html); iOS Safari does not, so
 * there the frame's bottom is lifted by the part of the window the keyboard covers, which keeps
 * the sticky toolbar (audience, Cancel, Save) just above the keys.
 */
export function useKeyboardInset(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = ref.current;
    if (!enabled || !viewport || !element) return;
    const update = () => {
      const covered = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      element.style.bottom = covered > 0 ? `${covered}px` : "";
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      element.style.bottom = "";
    };
  }, [ref, enabled]);
}
