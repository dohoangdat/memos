import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// A collapsed section shows this much content; anything taller folds behind a fade.
export const CLAMP_PREVIEW_HEIGHT_PX = 240;
// Only fold when content is taller than this, so cards barely over the preview aren't
// clamped for the sake of a few hidden pixels.
export const CLAMP_TRIGGER_HEIGHT_PX = 288;

interface ClampedSectionProps {
  /** When false, children render untouched with no measurement. */
  enabled: boolean;
  children: ReactNode;
}

/**
 * The preview of a memo in a list: content taller than the trigger is cut to a fixed-height
 * preview behind a fade. There is no in-place expand; the card opens the memo full screen
 * to read the rest. The inner div is never clamped, so observing it keeps the measurement
 * live while images and embeds load.
 */
const ClampedSection = ({ enabled, children }: ClampedSectionProps) => {
  const measureRef = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState(false);

  useEffect(() => {
    const el = measureRef.current;
    if (!enabled || !el) {
      setClamped(false);
      return;
    }
    const check = () => setClamped(el.offsetHeight > CLAMP_TRIGGER_HEIGHT_PX);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  return (
    <div
      className={cn("relative w-full", clamped && "overflow-hidden")}
      style={clamped ? { maxHeight: CLAMP_PREVIEW_HEIGHT_PX } : undefined}
      data-clamped={clamped || undefined}
    >
      <div ref={measureRef} className="w-full flex flex-col justify-start items-start gap-2">
        {children}
      </div>
      {clamped && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-mu-surface from-0% via-mu-surface/60 via-40% to-transparent to-100%" />
      )}
    </div>
  );
};

export default ClampedSection;
