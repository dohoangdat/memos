import { FlameIcon, type LucideIcon, PinIcon, StarIcon, TagIcon } from "lucide-react";

/**
 * The sidebar's built-in views, before the user's own: pinned memos, memos the user starred
 * (their ⭐ reaction), the memos opened most on this device, and memos without any tag. Their ids share the memo view
 * selection with saved views and never collide with a saved view's id.
 */
export const BUILTIN_VIEWS = [
  { id: "builtin:pinned", icon: PinIcon, labelKey: "builtin-view.pinned" },
  { id: "builtin:starred", icon: StarIcon, labelKey: "builtin-view.starred" },
  { id: "builtin:top-opens", icon: FlameIcon, labelKey: "builtin-view.top-opens" },
  { id: "builtin:untagged", icon: TagIcon, labelKey: "builtin-view.untagged" },
] as const satisfies readonly { id: string; icon: LucideIcon; labelKey: string }[];

export type BuiltinViewId = (typeof BUILTIN_VIEWS)[number]["id"];

export const findBuiltinView = (id: string | undefined) => BUILTIN_VIEWS.find((view) => view.id === id);

/** A memo filter selecting exactly these memos by uid; an empty list selects none. */
export const uidInFilter = (uids: readonly string[]): string => `uid in [${uids.map((uid) => JSON.stringify(uid)).join(", ")}]`;
