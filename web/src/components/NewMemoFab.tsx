import { MicIcon, PencilLineIcon, PlusIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { VoiceNoteDialog } from "@/components/VoiceNote/VoiceNoteDialog";
import { useGlobalMemoEditor } from "@/contexts/GlobalMemoEditorContext";
import { useLLMFeatures } from "@/hooks/useLLM";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";

/**
 * A floating ＋ at the bottom of the page. With voice notes on (Settings → LLM features) it opens
 * two choices, Write and Record; otherwise it writes at once. Writing opens the composer full
 * screen with the keyboard up: phones only show the keyboard for a focus made during the tap
 * itself, while the editor mounts a moment later, so the tap first focuses a hidden field to
 * raise the keyboard; the editor's own autofocus then takes it over.
 */
const NewMemoFab = ({ className }: { className?: string }) => {
  const t = useTranslate();
  const { canOpen, openEditor } = useGlobalMemoEditor();
  const { data: llm } = useLLMFeatures();
  const keyboardRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  if (!canOpen) return null;

  const write = () => {
    keyboardRef.current?.focus({ preventScroll: true });
    setMenuOpen(false);
    openEditor();
  };
  const voice = Boolean(llm?.voiceNote);
  const bottom = "bottom-[max(1rem,env(safe-area-inset-bottom))]";
  const choice =
    "flex items-center gap-2 rounded-full border border-mu-line bg-mu-surface py-2 ps-3 pe-4 mu-label text-mu-text shadow-md mu-focus active:scale-95";

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
      {menuOpen && (
        <>
          <button
            type="button"
            aria-label={t("common.close")}
            className="fixed inset-0 z-30 bg-mu-overlay/40"
            onClick={() => setMenuOpen(false)}
          />
          <div className="fixed end-4 bottom-[calc(max(1rem,env(safe-area-inset-bottom))+4.5rem)] z-30 flex flex-col items-end gap-2">
            <button type="button" className={choice} onClick={() => (setMenuOpen(false), setRecording(true))}>
              <MicIcon className="mu-icon text-mu-danger" />
              {t("voice-note.record")}
            </button>
            <button type="button" className={choice} onClick={write}>
              <PencilLineIcon className="mu-icon" />
              {t("voice-note.write")}
            </button>
          </div>
        </>
      )}
      <button
        type="button"
        data-new-memo-trigger
        aria-label={t("editor.new-memo")}
        aria-expanded={voice ? menuOpen : undefined}
        title={t("editor.new-memo")}
        onClick={() => (voice ? setMenuOpen(!menuOpen) : write())}
        className={cn(
          `fixed end-4 ${bottom} z-30 flex size-14 items-center justify-center`,
          "rounded-full border border-transparent bg-mu-primary text-mu-on-primary shadow-lg transition-transform active:scale-95 mu-focus",
          className,
        )}
      >
        {menuOpen ? <XIcon className="mu-icon" /> : <PlusIcon className="mu-icon" />}
      </button>
      {voice && <VoiceNoteDialog open={recording} onClose={() => setRecording(false)} />}
    </>
  );
};

export default NewMemoFab;
