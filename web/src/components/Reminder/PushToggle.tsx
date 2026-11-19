import { Button } from "@usememos/ui";
import { BellOffIcon, BellRingIcon, SendIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { disablePush, enablePush, type PushState, pushState, sendTestPush } from "@/lib/push";
import { showErrorToast, toast } from "@/lib/toast";
import { useTranslate } from "@/utils/i18n";

/** Whether this device gets reminder notifications, with the switch and a test. */
export const PushToggle = ({ compact = false }: { compact?: boolean }) => {
  const t = useTranslate();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void pushState().then(setState);
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t("common.error-occurred"));
    } finally {
      setBusy(false);
      setState(await pushState());
    }
  };

  if (state === null) return null;
  if (state === "needs-install") return <p className="mu-caption text-mu-text-secondary">{t("reminder.needs-install")}</p>;
  if (state === "unsupported") return <p className="mu-caption text-mu-text-secondary">{t("reminder.unsupported")}</p>;
  if (state === "denied") return <p className="mu-caption text-mu-danger">{t("reminder.denied")}</p>;
  if (state === "off") {
    return (
      <div className="flex flex-col items-start gap-1">
        {compact && <p className="mu-caption text-mu-text-secondary">{t("reminder.device-off")}</p>}
        <Button
          variant="primary"
          size="sm"
          icon={<BellRingIcon />}
          loading={busy}
          onClick={() => void run(async () => void (await enablePush()))}
        >
          {t("reminder.enable-device")}
        </Button>
      </div>
    );
  }
  if (compact) return <p className="mu-caption text-mu-text-secondary">{t("reminder.device-on")}</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mu-body text-mu-text">{t("reminder.device-on")}</span>
      <Button
        variant="neutral"
        size="sm"
        icon={<SendIcon />}
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const { sent } = await sendTestPush();
            toast.add({ title: t("reminder.test-sent", { n: sent }), type: sent > 0 ? "success" : "info" });
          })
        }
      >
        {t("reminder.test")}
      </Button>
      <Button variant="ghost" size="sm" icon={<BellOffIcon />} disabled={busy} onClick={() => void run(disablePush)}>
        {t("reminder.disable-device")}
      </Button>
    </div>
  );
};
