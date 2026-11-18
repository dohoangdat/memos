import { useQueryClient } from "@tanstack/react-query";
import { CloudOffIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { flushOutbox, useOutbox } from "@/lib/offline/outbox";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";

const useOnline = () => {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
};

/**
 * A slim bar at the top while the app is offline or has changes waiting to sync. Expanding it
 * lists the memos written offline; Sync now sends them when the server can be reached.
 */
const OfflineBar = () => {
  const t = useTranslate();
  const queryClient = useQueryClient();
  const online = useOnline();
  const { entries, syncing } = useOutbox();
  const [open, setOpen] = useState(false);
  if (online && entries.length === 0) return null;

  const created = entries.filter((entry) => entry.kind === "create");
  return (
    <div role="status" className="sticky top-0 z-(--mu-layer-popup) border-b border-mu-line bg-mu-well/95 backdrop-blur">
      <div className="mx-auto flex min-h-9 w-full items-center gap-2 px-3 mu-caption text-mu-text-secondary">
        <CloudOffIcon className={cn("mu-icon-sm shrink-0", online && "opacity-40")} />
        <button
          type="button"
          className="min-w-0 flex-1 truncate rounded-mu-sm border border-transparent text-start mu-focus"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {online ? "" : `${t("offline.offline")} · `}
          {entries.length > 0 ? t("offline.pending", { n: entries.length }) : t("offline.showing-saved")}
        </button>
        {online && entries.length > 0 && (
          <button
            type="button"
            disabled={syncing}
            onClick={() => void flushOutbox(queryClient)}
            className="inline-flex shrink-0 items-center gap-1 rounded-mu-md border border-transparent px-2 py-1 text-mu-text hover:bg-mu-hover mu-focus disabled:opacity-60"
          >
            <RefreshCwIcon className={cn("mu-icon-xs", syncing && "animate-spin")} />
            {t("offline.sync-now")}
          </button>
        )}
      </div>
      {open && created.length > 0 && (
        <ul className="mx-auto flex max-h-60 w-full flex-col gap-1 overflow-y-auto px-3 pb-2">
          {created.map((entry) => (
            <li key={entry.id} className="truncate rounded-mu-md bg-mu-surface px-2 py-1 mu-body text-mu-text">
              {entry.memo.content.split("\n").find((line) => line.trim()) || "…"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default OfflineBar;
