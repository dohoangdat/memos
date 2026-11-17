import { useMemo } from "react";
import { type MemoFilter, useMemoFilterContext } from "@/contexts/MemoFilterContext";
import { type MemoTimeBasis, useView } from "@/contexts/ViewContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useStarredMemoUids } from "@/hooks/useStarredMemos";
import { useMemoViews } from "@/hooks/useUserQueries";
import { uidInFilter } from "@/lib/builtin-views";
import { buildTimestampRangeFilter, getLocalDayTimestampRange, getTimeBasisField } from "@/lib/calendar-utils";
import { combineCELFilters } from "@/lib/cel-filter";
import { getMemoViewId } from "@/lib/memo-views";
import { buildMemoCreatorFilter, getVisibilityName } from "@/lib/resource-names";
import { Visibility } from "@/types/proto/api/memo_service_pb";
import { topOpenedMemoUids } from "@/utils/memo-opens";

const escapeFilterValue = (value: string): string => JSON.stringify(value);

export interface UseMemoFiltersOptions {
  creatorName?: string;
  includeMemoViews?: boolean;
  includePinned?: boolean;
  visibilities?: Visibility[];
}

interface BuildMemoFilterOptions {
  creatorName?: string;
  filters: MemoFilter[];
  includePinned: boolean;
  selectedMemoViewFilter?: string;
  visibilities?: Visibility[];
  /** Which timestamp a `displayTime` day filter selects on; defaults to creation time. */
  timeBasis?: MemoTimeBasis;
}

export const buildMemoFilter = ({
  creatorName,
  filters,
  includePinned,
  selectedMemoViewFilter,
  visibilities,
  timeBasis = "create_time",
}: BuildMemoFilterOptions): string | undefined => {
  const conditions: string[] = [];

  if (creatorName) {
    const creatorFilter = buildMemoCreatorFilter(creatorName);
    if (creatorFilter) {
      conditions.push(creatorFilter);
    }
  }

  if (selectedMemoViewFilter) {
    conditions.push(selectedMemoViewFilter);
  }

  for (const filter of filters) {
    if (filter.factor === "contentSearch") {
      conditions.push(`content.contains(${escapeFilterValue(filter.value)})`);
    } else if (filter.factor === "celSearch") {
      conditions.push(filter.value);
    } else if (filter.factor === "tagSearch") {
      conditions.push(`tag in [${escapeFilterValue(filter.value)}]`);
    } else if (filter.factor === "pinned") {
      if (includePinned) {
        conditions.push(`pinned`);
      }
    } else if (filter.factor === "property.hasLink") {
      conditions.push(`has_link`);
    } else if (filter.factor === "property.hasTaskList") {
      conditions.push(`has_task_list`);
    } else if (filter.factor === "property.hasCode") {
      conditions.push(`has_code`);
    } else if (filter.factor === "property.hasLocation") {
      conditions.push(`has_location`);
    } else if (filter.factor === "property.hasAttachments") {
      conditions.push(`has_attachments`);
    } else if (filter.factor === "property.hasImage") {
      conditions.push(`has_image`);
    } else if (filter.factor === "displayTime") {
      const range = getLocalDayTimestampRange(filter.value);
      if (range) {
        conditions.push(buildTimestampRangeFilter(getTimeBasisField(timeBasis), range));
      }
    }
  }

  if (visibilities && visibilities.length > 0) {
    const visibilityValues = visibilities.map((visibility) => `"${getVisibilityName(visibility)}"`).join(", ");
    conditions.push(`visibility in [${visibilityValues}]`);
  }

  return combineCELFilters(...conditions);
};

/** CEL filter of the View selected in the sidebar: a built-in one, or a saved one's stored filter. */
export const useSelectedMemoViewFilter = (): string | undefined => {
  const currentUser = useCurrentUser();
  const { memoView } = useMemoFilterContext();
  const { data: memoViews = [] } = useMemoViews(currentUser?.name);
  const { data: starredUids } = useStarredMemoUids(memoView === "builtin:starred");
  return useMemo(() => {
    if (memoView === "builtin:pinned") return "pinned";
    if (memoView === "builtin:starred") return uidInFilter(starredUids ?? []);
    if (memoView === "builtin:top-opens") return uidInFilter(topOpenedMemoUids());
    return memoViews.find((view) => getMemoViewId(view.name) === memoView)?.filter;
  }, [memoView, memoViews, starredUids]);
};

export const useMemoFilters = (options: UseMemoFiltersOptions = {}): string | undefined => {
  const { creatorName, includeMemoViews = false, includePinned = false, visibilities } = options;

  const { filters } = useMemoFilterContext();
  const selectedMemoViewFilter = useSelectedMemoViewFilter();
  // The sidebar calendar buckets days by this basis, so a picked day must select on it too.
  const { timeBasis } = useView();

  return useMemo(
    () =>
      buildMemoFilter({
        creatorName,
        filters,
        includePinned,
        selectedMemoViewFilter: includeMemoViews ? selectedMemoViewFilter : undefined,
        visibilities,
        timeBasis,
      }),
    [creatorName, filters, includePinned, includeMemoViews, selectedMemoViewFilter, visibilities, timeBasis],
  );
};
