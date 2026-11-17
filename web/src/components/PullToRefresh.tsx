import { useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/** How far (px) the finger travels before releasing refreshes. */
const TRIGGER = 72;
/** The indicator follows the finger at this fraction of the pull, up to MAX_OFFSET. */
const RESISTANCE = 0.5;
const MAX_OFFSET = 96;

const isScrolledDown = (element: Element | null, stop: Element | null): boolean => {
  for (let current = element; current && current !== stop; current = current.parentElement) {
    if (current.scrollTop > 0) return true;
  }
  return false;
};

interface PullToRefreshOptions {
  /** The scroller to watch; the page itself when omitted. */
  scrollRef?: RefObject<HTMLElement | null>;
  /** Defaults to refetching every query on screen. */
  onRefresh?: () => Promise<unknown>;
  /** The page-level instance leaves touches inside dialogs to their own instance. */
  ignoreDialogs?: boolean;
}

/**
 * Pull down at the top of a list or a memo to refresh it, as in a native app. Touch only; the
 * installed app has no browser pull-to-refresh of its own. A touch that starts in a scrolled
 * inner area (a code block, a table) scrolls that area instead.
 */
export function PullToRefresh({ scrollRef, onRefresh, ignoreDialogs = false }: PullToRefreshOptions) {
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pulling = useRef(false);
  const offsetRef = useRef(0);

  const refresh = useCallback(() => (onRefresh ? onRefresh() : queryClient.refetchQueries({ type: "active" })), [onRefresh, queryClient]);

  useEffect(() => {
    const target: HTMLElement | Window = scrollRef?.current ?? window;
    const scrollTop = () => (scrollRef?.current ? scrollRef.current.scrollTop : window.scrollY);
    const setPull = (value: number) => {
      offsetRef.current = value;
      setOffset(value);
    };

    const onStart = (event: TouchEvent) => {
      const element = event.target as Element;
      if (refreshing || event.touches.length !== 1 || scrollTop() > 0) return;
      if (ignoreDialogs && element.closest('[role="dialog"]')) return;
      if (isScrolledDown(element, scrollRef?.current ?? null)) return;
      start.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      pulling.current = false;
    };
    const onMove = (event: TouchEvent) => {
      if (!start.current) return;
      const dx = event.touches[0].clientX - start.current.x;
      const dy = event.touches[0].clientY - start.current.y;
      if (!pulling.current) {
        // Decide once: a mostly vertical downward drag at the top is a pull; anything else is not ours.
        if (Math.abs(dy) < 8) return;
        if (dy < 0 || Math.abs(dx) > Math.abs(dy) || scrollTop() > 0) {
          start.current = null;
          return;
        }
        pulling.current = true;
      }
      event.preventDefault();
      setPull(Math.min(MAX_OFFSET, Math.max(0, dy) * RESISTANCE));
    };
    const onEnd = () => {
      if (!start.current) return;
      start.current = null;
      const released = offsetRef.current;
      pulling.current = false;
      if (released >= TRIGGER * RESISTANCE) {
        setRefreshing(true);
        setPull(TRIGGER * RESISTANCE);
        Promise.resolve(refresh())
          .catch(() => undefined)
          .finally(() => {
            setRefreshing(false);
            setPull(0);
          });
      } else {
        setPull(0);
      }
    };

    target.addEventListener("touchstart", onStart as EventListener, { passive: true });
    target.addEventListener("touchmove", onMove as EventListener, { passive: false });
    target.addEventListener("touchend", onEnd);
    target.addEventListener("touchcancel", onEnd);
    return () => {
      target.removeEventListener("touchstart", onStart as EventListener);
      target.removeEventListener("touchmove", onMove as EventListener);
      target.removeEventListener("touchend", onEnd);
      target.removeEventListener("touchcancel", onEnd);
    };
  }, [scrollRef, refresh, refreshing, ignoreDialogs]);

  if (!offset && !refreshing) return null;
  const progress = Math.min(1, offset / (TRIGGER * RESISTANCE));
  const indicator = (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-(--mu-layer-popup) flex justify-center pt-[env(safe-area-inset-top)]"
      style={{ transform: `translateY(${offset}px)`, transition: pulling.current ? "none" : "transform 150ms ease-out" }}
    >
      <span className="flex size-9 items-center justify-center rounded-full border border-mu-line bg-mu-surface text-mu-text shadow-md">
        <RefreshCwIcon
          className={cn("mu-icon", refreshing && "animate-spin")}
          style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)`, opacity: 0.4 + progress * 0.6 }}
        />
      </span>
    </div>
  );
  return createPortal(indicator, document.body);
}
