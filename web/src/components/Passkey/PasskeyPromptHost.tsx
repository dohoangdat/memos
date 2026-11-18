import { Button, Dialog } from "@usememos/ui";
import { LockKeyholeIcon } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router-dom";
import { usePasskeyRecord } from "@/hooks/useMemoProtection";
import { setSessionKey } from "@/lib/memo-crypto";
import { formatWait, passkeyRefusal, unlockWithPasskey } from "@/lib/passkey";
import { showErrorToast } from "@/lib/toast";
import { useTranslate } from "@/utils/i18n";
import { PasskeyInput } from "./PasskeyInput";
import { getPendingPasskeyRequest, settlePasskeyRequest, subscribePasskeyRequest } from "./passkeyPrompt";
import { usePasskeyWait } from "./usePasskeyWait";

/**
 * Shows the passkey dialog whenever something asks for it (see `ensurePasskey`). The server
 * checks the passkey and rate limits wrong ones; the dialog shows the tries left and counts
 * down any wait it imposes.
 */
export const PasskeyPromptHost = () => {
  const t = useTranslate();
  const navigate = useNavigate();
  const request = useSyncExternalStore(subscribePasskeyRequest, getPendingPasskeyRequest, () => null);
  const { data: record, refetch } = usePasskeyRecord();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const wait = usePasskeyWait(record?.configured ? record.retryAfter : 0);
  const waiting = wait.remaining > 0;

  const close = (key: CryptoKey | null) => {
    setValue("");
    setError("");
    settlePasskeyRequest(key);
  };

  const submit = async (digits: string) => {
    if (!record?.configured || checking || waiting) return;
    setChecking(true);
    try {
      const key = await unlockWithPasskey(digits, record.salt);
      setSessionKey(key);
      close(key);
    } catch (failure) {
      const refusal = passkeyRefusal(failure);
      if (!refusal) {
        showErrorToast(failure instanceof Error ? failure.message : t("common.error-occurred"));
        return;
      }
      wait.start(refusal.retryAfter);
      setError(refusal.wrong && refusal.retryAfter === 0 ? t("passkey.wrong-left", { n: refusal.attemptsLeft }) : "");
      setValue("");
      // Keep the record's wait in step for the next time the dialog opens.
      void refetch();
    } finally {
      setChecking(false);
    }
  };

  return (
    <Dialog.Root open={Boolean(request)} onOpenChange={(open) => !open && close(null)}>
      <Dialog.Popup className="w-sm max-w-[calc(100vw-1rem)]">
        <Dialog.Title className="flex items-center gap-2">
          <LockKeyholeIcon className="mu-icon" />
          {t("passkey.unlock-title")}
        </Dialog.Title>
        {record && !record.configured ? (
          <>
            <Dialog.Description>{t("passkey.not-configured")}</Dialog.Description>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="neutral" onClick={() => close(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  close(null);
                  navigate("/setting#passkey");
                }}
              >
                {t("passkey.setup")}
              </Button>
            </div>
          </>
        ) : (
          <form
            className="mt-2 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(value);
            }}
          >
            <Dialog.Description>{request?.reason ?? t("passkey.unlock-description")}</Dialog.Description>
            <PasskeyInput
              autoFocus
              label={t("passkey.label")}
              value={value}
              disabled={checking || waiting || !record}
              onChange={(digits) => {
                setValue(digits);
                setError("");
              }}
              onComplete={(digits) => void submit(digits)}
            />
            {(waiting || error) && (
              <p role="alert" className="mu-caption text-mu-danger">
                {waiting ? t("passkey.wait", { time: formatWait(wait.remaining) }) : error}
              </p>
            )}
            <p className="mu-caption text-mu-text-secondary">{t("passkey.session-note")}</p>
            <div className="flex justify-end gap-2">
              <Button variant="neutral" type="button" onClick={() => close(null)}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" type="submit" disabled={value.length !== 6 || checking || waiting}>
                {t("passkey.unlock")}
              </Button>
            </div>
          </form>
        )}
      </Dialog.Popup>
    </Dialog.Root>
  );
};
