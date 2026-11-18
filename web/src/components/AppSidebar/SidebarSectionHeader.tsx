import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
  action?: ReactNode;
  /** When set, the label is a disclosure: › while collapsed, ⌄ while open. */
  collapsed?: boolean;
  onToggle?: () => void;
}

const LABEL_CLASSES = "min-w-0 truncate ps-2 mu-label-sm text-mu-text-secondary select-none";

const SidebarSectionHeader = ({ children, action, collapsed, onToggle }: Props) => (
  <div className="mb-0.5 flex h-6 min-w-0 items-center justify-between gap-2">
    {/* Sentence case at the small label weight: it reads apart from the 400-weight muted rows by
        weight and space, not by capitals or a size below the type scale. */}
    {onToggle ? (
      <h2 className="min-w-0 flex-1">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className={cn(
            LABEL_CLASSES,
            "flex w-full items-center gap-1 rounded-mu-sm border border-transparent text-start mu-focus hover:text-mu-text",
          )}
        >
          <span className="min-w-0 truncate">{children}</span>
          <ChevronRightIcon aria-hidden className={cn("mu-icon-xs shrink-0 transition-transform", !collapsed && "rotate-90")} />
        </button>
      </h2>
    ) : (
      <h2 className={LABEL_CLASSES}>{children}</h2>
    )}
    {action}
  </div>
);

export default SidebarSectionHeader;
