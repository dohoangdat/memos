import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@usememos/ui";
import { LockKeyholeIcon, LockKeyholeOpenIcon } from "lucide-react";
import { useState } from "react";
import { PasskeyInput } from "@/components/Passkey/PasskeyInput";
import { usePasskeyWait } from "@/components/Passkey/usePasskeyWait";
import { protectionKeys, useMemoProtections, usePasskeyRecord, useSessionKey } from "@/hooks/useMemoProtection";
import { memoKeys } from "@/hooks/useMemoQueries";
import { PASSKEY_PATTERN, setSessionKey } from "@/lib/memo-crypto";
import { changePasskey, formatWait, passkeyRefusal, setupPasskey } from "@/lib/passkey";
import { showErrorToast, toast } from "@/lib/toast";
import { useTranslate } from "@/utils/i18n";
import { SettingList, SettingListItem } from "./SettingList";
import SettingSection from "./SettingSection";

/**
 * The 6-digit passkey that locks memos. The server checks it with a rate limit; changing it
 * needs the current passkey and re-encrypts every locked memo in this browser first.
 */
const PasskeySection = () => {
  const t = useTranslate();
  const queryClient = useQueryClient();
  const { data: record, isLoading } = usePasskeyRecord();
  const { data: protections = {} } = useMemoProtections();
  const sessionKey = useSessionKey();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const configured = Boolean(record?.configured);
  const wait = usePasskeyWait(record?.configured ? record.retryAfter : 0);
  const lockedNames = Object.entries(protections)
    .filter(([, mode]) => mode === "lock")
    .map(([uid]) => `memos/${uid}`);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setProgress("");
  };

  const save = async () => {
    if (!PASSKEY_PATTERN.test(next) || next !== confirm) {
      showErrorToast(t("passkey.mismatch"));
      return;
    }
    setBusy(true);
    try {
      const onProgress = (done: number) => setProgress(t("passkey.reencrypting", { done, total: lockedNames.length }));
      const key = record?.configured
        ? await changePasskey({ passkey: current, salt: record.salt }, next, lockedNames, onProgress)
        : await setupPasskey(next);
      setSessionKey(key);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: protectionKeys.passkey }),
        queryClient.invalidateQueries({ queryKey: memoKeys.all }),
      ]);
      toast.add({ title: t(configured ? "passkey.changed" : "passkey.created"), type: "success" });
      reset();
    } catch (error) {
      const refusal = passkeyRefusal(error);
      if (refusal) {
        wait.start(refusal.retryAfter);
        if (refusal.retryAfter === 0) showErrorToast(t("passkey.wrong-left", { n: refusal.attemptsLeft }));
        setCurrent("");
        setProgress("");
        void queryClient.invalidateQueries({ queryKey: protectionKeys.passkey });
      } else {
        showErrorToast(error instanceof Error ? error.message : t("common.error-occurred"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingSection title={t("setting.passkey.label")} description={t("passkey.section-description")}>
      <SettingList aria-label={t("setting.passkey.label")}>
        <SettingListItem label={t("passkey.status")} description={configured ? t("passkey.status-on") : t("passkey.status-off")}>
          {configured && (
            <Button
              variant="neutral"
              size="sm"
              icon={sessionKey ? <LockKeyholeIcon /> : <LockKeyholeOpenIcon />}
              disabled={!sessionKey}
              onClick={() => setSessionKey(null)}
            >
              {sessionKey ? t("passkey.lock-now") : t("passkey.locked")}
            </Button>
          )}
        </SettingListItem>
        {!isLoading && (
          <SettingListItem label={configured ? t("passkey.change") : t("passkey.setup")} orientation="vertical">
            <form
              className="flex w-full max-w-xs flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              {configured && <PasskeyInput label={t("passkey.current")} value={current} onChange={setCurrent} disabled={busy} />}
              <PasskeyInput label={t("passkey.new")} value={next} onChange={setNext} disabled={busy} />
              <PasskeyInput label={t("passkey.confirm")} value={confirm} onChange={setConfirm} disabled={busy} />
              {progress && <p className="mu-caption text-mu-text-secondary">{progress}</p>}
              {wait.remaining > 0 && (
                <p role="alert" className="mu-caption text-mu-danger">
                  {t("passkey.wait", { time: formatWait(wait.remaining) })}
                </p>
              )}
              <p className="mu-caption text-mu-text-secondary">{t("passkey.strength-note")}</p>
              <Button
                type="submit"
                variant="primary"
                disabled={busy || wait.remaining > 0 || next.length !== 6 || confirm.length !== 6 || (configured && current.length !== 6)}
              >
                {configured ? t("passkey.change") : t("passkey.setup")}
              </Button>
            </form>
          </SettingListItem>
        )}
      </SettingList>
    </SettingSection>
  );
};

export default PasskeySection;
