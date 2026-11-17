import { create } from "@bufbuild/protobuf";
import { Button, Spinner } from "@usememos/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useCreateMemo } from "@/hooks/useMemoQueries";
import { toast } from "@/lib/toast";
import { ROUTES } from "@/router/routes";
import { MemoSchema } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { convertVisibilityFromString } from "@/utils/memo";
import { buildSharedMemoContent } from "@/utils/share-target";

/**
 * The installed app's share target (see `share_target` in site.webmanifest): another app's
 * share sheet opens `/share?title=…&text=…&url=…`, and this page saves it as a new memo at once,
 * then opens that memo. History is replaced, so going back never shares the same link twice.
 */
const ShareTarget = () => {
  const t = useTranslate();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { userGeneralSetting } = useAuth();
  const { mutate: createMemo } = useCreateMemo();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const content = buildSharedMemoContent({ title: params.get("title"), text: params.get("text"), url: params.get("url") });

  const save = useCallback(() => {
    setFailed(false);
    const visibility = convertVisibilityFromString(userGeneralSetting?.memoVisibility ?? "");
    createMemo(
      { memo: create(MemoSchema, { content, visibility }) },
      {
        onSuccess: (memo) => {
          toast.add({ title: t("share-target.saved"), type: "success" });
          navigate(`/${memo.name}`, { replace: true });
        },
        onError: () => setFailed(true),
      },
    );
  }, [content, createMemo, navigate, t, userGeneralSetting?.memoVisibility]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!content) {
      navigate(ROUTES.HOME, { replace: true });
      return;
    }
    save();
  }, [content, navigate, save]);

  return (
    <section className="flex min-h-[60svh] w-full flex-col items-center justify-center gap-4 px-4 text-center">
      {failed ? (
        <>
          <p role="alert" className="mu-body text-mu-text">
            {t("share-target.failed")}
          </p>
          <div className="flex gap-2">
            <Button variant="neutral" onClick={() => navigate(ROUTES.HOME, { replace: true })}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" onClick={save}>
              {t("share-target.retry")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <Spinner />
          <p className="mu-body text-mu-text-secondary">{t("share-target.saving")}</p>
        </>
      )}
    </section>
  );
};

export default ShareTarget;
