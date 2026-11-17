import type { Location, Memo, Visibility } from "@/types/proto/api/memo_service_pb";
import type { User } from "@/types/proto/api/user_service_pb";
import { canManageMemo } from "@/utils/user";
import { cacheService } from "./services/cacheService";
import { memoService } from "./services/memoService";
import { createInitialState, type EditorState } from "./state/types";

/**
 * Whether a session may place the memo in a Space of its own. Replies are never placed
 * independently: a comment's Space is its parent's. An edited top-level memo can change
 * its Space; a new one can unless its host fixes the target, such as composing inside a
 * Space.
 */
export const canChooseSpaceFor = ({
  memo,
  currentUser,
  parentMemoName,
  defaultSpace,
}: {
  memo?: Memo;
  currentUser: User | undefined;
  parentMemoName?: string;
  defaultSpace?: string;
}): boolean => (memo ? !memo.parent && canManageMemo(memo, currentUser) : !parentMemoName && !defaultSpace);

export interface InitialEditorStateOptions {
  /** The memo being edited; its draft is never restored from the cache. */
  memo?: Memo;
  /** The persisted draft's key, for a new memo or comment. */
  draftKey: string;
  initialFocusMode?: boolean;
  defaultVisibility?: Visibility;
  defaultCreateTime?: Date;
  defaultLocation?: Location;
  /** Whether the draft may carry a Space of its own; a comment's Space is its parent's. */
  canChooseSpace?: boolean;
  /** Text to start with (shared from another app): a new memo's content, or appended to an edited memo's. */
  seedContent?: string;
}

/** `addition` as a new block after `content`. */
const appendBlock = (content: string, addition: string) => {
  const head = content.replace(/\s+$/, "");
  return head ? `${head}\n\n${addition}` : addition;
};

/**
 * The draft store's first state, computed once when editing starts: the memo's own
 * fields for an edit, otherwise the persisted draft under `draftKey` over the host's
 * defaults. A cached `null` location is one the user removed, so the default does not
 * come back.
 */
export function initialEditorState({
  memo,
  draftKey,
  initialFocusMode = false,
  defaultVisibility,
  defaultCreateTime,
  defaultLocation,
  canChooseSpace = false,
  seedContent,
}: InitialEditorStateOptions): EditorState {
  const base = createInitialState(initialFocusMode);
  if (memo) {
    cacheService.clear(draftKey);
    const state = { ...base, ...memoService.fromMemo(memo) };
    return seedContent ? { ...state, content: appendBlock(state.content, seedContent) } : state;
  }
  const draft = cacheService.loadDraft(draftKey);
  const visibility = draft.visibility ?? defaultVisibility ?? base.metadata.visibility;
  return {
    ...base,
    content: seedContent ?? draft.content,
    metadata: {
      ...base.metadata,
      attachments: draft.attachments.length > 0 ? draft.attachments : base.metadata.attachments,
      location: draft.location === null ? undefined : (draft.location ?? defaultLocation),
      visibility,
      space: canChooseSpace ? draft.space : undefined,
    },
    timestamps: defaultCreateTime ? { createTime: defaultCreateTime, updateTime: defaultCreateTime } : base.timestamps,
  };
}
