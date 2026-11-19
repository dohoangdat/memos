import { Button } from "@usememos/ui";
import { AlarmClockIcon, RepeatIcon, Trash2Icon } from "lucide-react";
import { Link } from "react-router-dom";
import { PushToggle } from "@/components/Reminder/PushToggle";
import { formatReminderTime, useDeleteReminder, useUpcomingReminders } from "@/hooks/useReminders";
import { showErrorToast } from "@/lib/toast";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "./SettingGroup";
import SettingSection from "./SettingSection";

/**
 * Reminders (fork, server/reminder): notifications on this device, and every upcoming reminder.
 * A reminder is set from a memo's ⋮ menu.
 */
const RemindersSection = () => {
  const t = useTranslate();
  const { data: reminders = [] } = useUpcomingReminders();
  const remove = useDeleteReminder();
  return (
    <SettingSection title={t("setting.reminders.label")} description={t("reminder.section-description")}>
      <SettingGroup title={t("reminder.this-device")} description={t("reminder.this-device-description")}>
        <PushToggle />
      </SettingGroup>
      <SettingGroup title={t("reminder.upcoming")}>
        {reminders.length === 0 ? (
          <p className="mu-caption text-mu-text-secondary">{t("reminder.none")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {reminders.map((item) => (
              <li key={item.id} className="flex items-center gap-2 rounded-mu-md border border-mu-line px-3 py-2">
                <AlarmClockIcon className="mu-icon-sm shrink-0 text-mu-text-secondary" />
                <Link to={`/memos/${item.memoUid}`} className="min-w-0 flex-1 truncate mu-body text-mu-text hover:underline">
                  {formatReminderTime(item.nextAt)}
                </Link>
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
                  onClick={() => remove.mutate(item.id, { onError: () => showErrorToast(t("common.error-occurred")) })}
                />
              </li>
            ))}
          </ul>
        )}
      </SettingGroup>
    </SettingSection>
  );
};

export default RemindersSection;
