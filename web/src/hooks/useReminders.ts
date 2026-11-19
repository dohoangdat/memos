import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { forkFetch } from "@/lib/fork-api";

export type ReminderRepeat = "none" | "daily" | "weekly" | "monthly" | "yearly";

export interface Reminder {
  id: number;
  memoUid: string;
  /** Unix seconds of the next notification. */
  nextAt: number;
  repeat: ReminderRepeat;
  tz: string;
}

export const reminderKeys = {
  all: ["reminders"] as const,
  memo: (uid: string) => ["reminders", "memo", uid] as const,
};

const uidOf = (memoName: string) => memoName.split("/").pop() ?? "";

export function useMemoReminders(memoName: string, enabled = true) {
  const uid = uidOf(memoName);
  return useQuery({
    queryKey: reminderKeys.memo(uid),
    enabled,
    queryFn: async () => (await forkFetch<{ reminders: Reminder[] }>(`/api/x/memos/${encodeURIComponent(uid)}/reminders`)).reminders,
  });
}

export function useUpcomingReminders() {
  return useQuery({
    queryKey: reminderKeys.all,
    queryFn: async () => (await forkFetch<{ reminders: Reminder[] }>("/api/x/reminders")).reminders,
  });
}

export function useAddReminder(memoName: string) {
  const queryClient = useQueryClient();
  const uid = uidOf(memoName);
  return useMutation({
    mutationFn: (input: { at: string; repeat: ReminderRepeat }) =>
      forkFetch<Reminder>(`/api/x/memos/${encodeURIComponent(uid)}/reminders`, {
        method: "POST",
        body: { ...input, tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
      }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: reminderKeys.all }),
  });
}

export function useDeleteReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => forkFetch(`/api/x/reminders/${id}`, { method: "DELETE" }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: reminderKeys.all }),
  });
}

/** "Thứ Năm, 20/11 09:00" in the user's language. */
export const formatReminderTime = (nextAt: number) =>
  new Date(nextAt * 1000).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
