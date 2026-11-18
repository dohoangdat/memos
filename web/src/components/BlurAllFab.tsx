import { EyeIcon, EyeOffIcon } from "lucide-react";
import { setBlurAll, useBlurAll } from "@/lib/blur-all";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";

/** A floating switch above the ＋ button that blurs every memo in lists at once, and back. */
const BlurAllFab = () => {
  const t = useTranslate();
  const blurred = useBlurAll();
  const label = blurred ? t("protect.unblur-all") : t("protect.blur-all");
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={blurred}
      title={label}
      onClick={() => setBlurAll(!blurred)}
      className={cn(
        "fixed end-5.5 bottom-[calc(max(1rem,env(safe-area-inset-bottom))+4.25rem)] z-30 flex size-11 items-center justify-center",
        "rounded-full border shadow-md transition-transform active:scale-95 mu-focus",
        blurred ? "border-transparent bg-mu-text text-mu-surface" : "border-mu-line bg-mu-surface text-mu-text-secondary",
      )}
    >
      {blurred ? <EyeOffIcon className="mu-icon" /> : <EyeIcon className="mu-icon" />}
    </button>
  );
};

export default BlurAllFab;
