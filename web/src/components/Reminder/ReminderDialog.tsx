import { Button, Dialog, Field, Input, Select } from "@usememos/ui";
import { AlarmClockIcon, PlusIcon, RepeatIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useBackToClose } from "@/hooks/useBackToClose";
import { formatReminderTime, type ReminderRepeat, useAddReminder, useDeleteReminder, useMemoReminders } from "@/hooks/useReminders";
import { showErrorToast, toast } from "@/lib/toast";
import { useTranslate } from "@/utils/i18n";
import { PushToggle } from "./PushToggle";

const REPEATS: ReminderRepeat[] = ["none", "daily", "weekly", "monthly", "yearly"];

/** An hour from now, on the hour, as a datetime-local value. */
const defaultTime = () => {
  const date = new Date(Date.now() + 3600_000);
  date.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const ReminderBody = ({ memoName, onClose }: { memoName: string; onClose: () => void }) => {
  const t = useTranslate();
  useBackToClose(onClose);
  const { data: reminders = [] } = useMemoReminders(memoName);
  const add = useAddReminder(memoName);
  const remove = useDeleteReminder();
  const [at, setAt] = useState(defaultTime);
  const [repeat, setRepeat] = useState<ReminderRepeat>("none");
  const items = REPEATS.map((value) => ({ value, label: t(`reminder.repeat-${value}`) }));

  const submit = async () => {
    try {
      await add.mutateAsync({ at, repeat });
      toast.add({ title: t("reminder.added"), type: "success" });
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : t("common.error-occurred"));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {reminders.length > 0 && (
        <ul className="flex flex-col gap-1">
          {reminders.map((item) => (
            <li key={item.id} className="flex items-center gap-2 rounded-mu-md border border-mu-line px-3 py-2">
              <AlarmClockIcon className="mu-icon-sm shrink-0 text-mu-text-secondary" />
              <span className="min-w-0 flex-1 mu-body text-mu-text">{formatReminderTime(item.nextAt)}</span>
              {item.repeat !== "none" && (
                <span className="inline-flex items-center gap-1 mu-caption text-mu-text-secondary">
                  <RepeatIcon className="mu-icon-xs" />
                  {t(`reminder.repeat-${item.repeat}`)}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2Icon />}
                aria-label={t("reminder.delete")}
                disabled={remove.isPending}
                onClick={() => remove.mutate(item.id, { onError: () => showErrorToast(t("common.error-occurred")) })}
              />
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field.Root>
          <Field.Label>{t("reminder.when")}</Field.Label>
          <Input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} required />
        </Field.Root>
        <Field.Root>
          <Field.Label>{t("reminder.repeat")}</Field.Label>
          <Select.Root value={repeat} items={items} onValueChange={(value) => value && setRepeat(value as ReminderRepeat)}>
            <Select.Trigger className="w-full">
              <Select.Value />
            </Select.Trigger>
            <Select.Popup>
              {items.map((item) => (
                <Select.Item key={item.value} value={item.value}>
                  {item.label}
                </Select.Item>
              ))}
            </Select.Popup>
          </Select.Root>
        </Field.Root>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="neutral" type="button" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button variant="primary" type="submit" icon={<PlusIcon />} loading={add.isPending} className="h-10! px-5! font-semibold">
            {t("reminder.add")}
          </Button>
        </div>
      </form>
      <div className="border-t border-mu-line pt-3">
        <PushToggle compact />
      </div>
    </div>
  );
};

/** Reminders of one memo: the upcoming ones, and a time and repeat for a new one. */
export const ReminderDialog = ({ memoName, open, onClose }: { memoName: string; open: boolean; onClose: () => void }) => {
  const t = useTranslate();
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Popup className="w-md max-w-[calc(100vw-1rem)]">
        <Dialog.Title className="flex items-center gap-2">
          <AlarmClockIcon className="mu-icon" />
          {t("reminder.title")}
        </Dialog.Title>
        {open && <ReminderBody memoName={memoName} onClose={onClose} />}
      </Dialog.Popup>
    </Dialog.Root>
  );
};
