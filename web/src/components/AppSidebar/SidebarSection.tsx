import type { ReactNode } from "react";
import { useLocalStorage } from "@/hooks";
import SidebarSectionHeader from "./SidebarSectionHeader";

export const SIDEBAR_SECTION_STACK_CLASSES = "flex flex-col gap-3";
export const SIDEBAR_SECTION_CONTENT_CLASSES = "flex flex-col gap-0.5";

interface Props {
  label?: ReactNode;
  ariaLabel?: string;
  children: ReactNode;
  action?: ReactNode;
  /** Makes the labelled section collapsible from its header; the state is kept per device under this id. */
  collapseId?: string;
}

const SidebarSection = ({ label, ariaLabel, children, action, collapseId }: Props) => {
  const [collapsed, setCollapsed] = useLocalStorage<boolean>(`sidebar-section-collapsed:${collapseId ?? ""}`, false);
  const collapsible = Boolean(collapseId) && label !== undefined;
  const isCollapsed = collapsible && Boolean(collapsed);
  return (
    <section className="w-full" aria-label={ariaLabel}>
      {label !== undefined && (
        <SidebarSectionHeader
          action={isCollapsed ? undefined : action}
          collapsed={collapsible ? isCollapsed : undefined}
          onToggle={collapsible ? () => setCollapsed(!isCollapsed) : undefined}
        >
          {label}
        </SidebarSectionHeader>
      )}
      {/* Flex gap keeps popup focus guards from affecting the visible row rhythm. */}
      {!isCollapsed && <div className={SIDEBAR_SECTION_CONTENT_CLASSES}>{children}</div>}
    </section>
  );
};

export default SidebarSection;
