import { PlusIcon } from "lucide-react";
import { useRef } from "react";
import { useGlobalMemoEditor } from "@/contexts/GlobalMemoEditorContext";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";

/**
 * A floating ＋ at the bottom of the page: opens the composer full screen with the keyboard up.
 * Phones only show the keyboard for a focus made during the tap itself, while the editor mounts
 * a moment later, so the tap first focuses a hidden field to raise the keyboard; the editor's own
 * autofocus then takes it over.
 */
const NewMemoFab = ({ className }: { className?: string }) => {
  const t = useTranslate();
  const { canOpen, openEditor } = useGlobalMemoEditor();
  const keyboardRef = useRef<HTMLInputElement>(null);
  if (!canOpen) return null;

  return (
    <>
      <input
        ref={keyboardRef}
        aria-hidden
        tabIndex={-1}
        className="pointer-events-none fixed bottom-0 start-0 size-px opacity-0"
        inputMode="text"
        onBlur={(event) => {
          event.currentTarget.value = "";
        }}
      />
      <button
        type="button"
        data-new-memo-trigger
        aria-label={t("editor.new-memo")}
        title={t("editor.new-memo")}
        onClick={() => {
          keyboardRef.current?.focus({ preventScroll: true });
          openEditor();
        }}
        className={cn(
          "fixed end-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center",
          "rounded-full border border-transparent bg-mu-primary text-mu-on-primary shadow-lg transition-transform active:scale-95 mu-focus",
          className,
        )}
      >
        <PlusIcon className="mu-icon" />
      </button>
    </>
  );
};

export default NewMemoFab;
