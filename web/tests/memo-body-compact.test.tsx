import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLAMP_PREVIEW_HEIGHT_PX, CLAMP_TRIGGER_HEIGHT_PX } from "@/components/ClampedSection";
import MemoBody from "@/components/MemoView/components/MemoBody";
import { setBlurAll } from "@/lib/blur-all";

const mockState = vi.hoisted(() => ({
  memo: {
    name: "memos/1",
    content: "",
    relations: [],
    attachments: [],
    reactions: [] as Array<{ reactionType: string; creator: string }>,
    tags: [] as string[],
  },
  blurred: false,
  showBlurredContent: false,
  toggleBlurVisibility: vi.fn(),
  reactionClick: vi.fn(),
  protection: undefined as "blur" | "lock" | undefined,
  decrypted: { locked: false, plain: null as string | null },
}));

vi.mock("@/components/MemoEditor/view/MemoContentView", () => ({
  MemoContentView: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("@/hooks/useMemoProtection", () => ({
  useMemoProtectionMode: () => mockState.protection,
  useDecryptedContent: (content: string) =>
    mockState.decrypted.locked ? { ...mockState.decrypted, failed: false } : { locked: false, plain: content, failed: false },
}));
vi.mock("@/components/Passkey/passkeyPrompt", () => ({ ensurePasskey: vi.fn(), requestPasskey: vi.fn() }));
vi.mock("@/utils/i18n", () => ({
  findNearestMatchedLanguage: (language: string) => language || "en",
  useTranslate: () => (key: string) => key,
}));

vi.mock("@/hooks/useCurrentUser", () => ({ default: () => undefined }));

vi.mock("@/contexts/MentionResolutionContext", () => ({
  useResolvedMentionUsernames: () => new Set<string>(),
}));

vi.mock("@/components/MemoEditor/MemoEditor", () => ({
  MemoEditor: ({ name }: { name: string }) => <div data-testid="memo-text">{mockState.memo.content ?? name}</div>,
}));

vi.mock("@/hooks/useMemoQueries", () => ({
  useUpdateMemo: () => ({ mutate: vi.fn() }),
}));

vi.mock("@/components/MemoMetadata", () => ({
  AttachmentGallery: () => null,
  MemoMetadataRows: () => null,
}));

vi.mock("@/components/MemoReactionListView", () => ({
  MemoReactionListView: ({ memo }: { memo: { reactions: unknown[] } }) =>
    memo.reactions.length > 0 ? (
      <button type="button" aria-label="memo-reaction" onClick={mockState.reactionClick}>
        Reaction
      </button>
    ) : null,
}));

vi.mock("@/components/MemoView/hooks", () => ({
  useMemoHandlers: () => ({
    handleMemoContentClick: vi.fn(),
    handleMemoContentDoubleClick: vi.fn(),
  }),
}));

vi.mock("@/components/MemoView/MemoViewContext", () => ({
  useMemoViewContext: () => ({
    memo: mockState.memo,
    parentPage: "",
    showBlurredContent: mockState.showBlurredContent,
    blurred: mockState.blurred,
    readonly: false,
    openEditor: vi.fn(),
    openPreview: vi.fn(),
    toggleBlurVisibility: mockState.toggleBlurVisibility,
  }),
}));

const createMemo = (content: string, reactions: Array<{ reactionType: string; creator: string }> = []) => ({
  name: "memos/1",
  content,
  relations: [],
  attachments: [],
  reactions,
  tags: [] as string[],
});

afterEach(() => {
  mockState.blurred = false;
  mockState.showBlurredContent = false;
  mockState.toggleBlurVisibility.mockReset();
  mockState.reactionClick.mockReset();
  vi.restoreAllMocks();
});

describe("<MemoBody /> protected memos", () => {
  afterEach(() => {
    mockState.protection = undefined;
    mockState.decrypted = { locked: false, plain: null };
    act(() => setBlurAll(false));
  });

  it("blurs every memo in lists while Blur all is on", () => {
    mockState.memo = createMemo("# Plans\n\nsecret body #private");
    render(<MemoBody compact={true} />);
    expect(screen.getByText(/secret body/)).toBeInTheDocument();
    act(() => setBlurAll(true));
    expect(screen.getByText("# Plans")).toBeInTheDocument();
    expect(screen.queryByText(/secret body/)).toBeNull();
    expect(screen.getByText("protect.blurred-hint")).toBeInTheDocument();
  });

  it("shows only the title of a blurred memo in a list", () => {
    mockState.protection = "blur";
    mockState.memo = createMemo("# Plans\n\nsecret body");
    render(<MemoBody compact={true} />);
    expect(screen.getByText("# Plans")).toBeInTheDocument();
    expect(screen.queryByText(/secret body/)).toBeNull();
    expect(screen.getByText("protect.blurred-hint")).toBeInTheDocument();
  });

  it("hides a locked memo's tags in its preview", () => {
    mockState.memo = {
      ...createMemo("# Bank\n\n🔒 #tai-chinh/ngan-hang\n\n```memos-lock\nabc\n```"),
      tags: ["tai-chinh", "tai-chinh/ngan-hang"],
    };
    mockState.decrypted = { locked: true, plain: null };
    render(<MemoBody compact={true} />);
    expect(screen.getByText("# Bank")).toBeInTheDocument();
    expect(screen.queryByText(/tai-chinh/)).toBeNull();
  });

  it("shows a blurred memo in full outside lists", () => {
    mockState.protection = "blur";
    mockState.memo = createMemo("# Plans\n\nsecret body");
    render(<MemoBody compact={false} />);
    expect(screen.queryByText("protect.blurred-hint")).toBeNull();
  });

  it("asks for the passkey before showing a locked memo, then shows its plaintext", () => {
    mockState.memo = createMemo("# Bank\n\n🔒\n\n```memos-lock\nabc\n```");
    mockState.decrypted = { locked: true, plain: null };
    const { rerender } = render(<MemoBody compact={false} />);
    expect(screen.getByText("# Bank")).toBeInTheDocument();
    expect(screen.getByText("protect.locked-hint")).toBeInTheDocument();
    expect(screen.queryByText(/memos-lock/)).toBeNull();

    mockState.decrypted = { locked: true, plain: "# Bank\n\nTK 123" };
    rerender(<MemoBody compact={false} />);
    expect(screen.getByText(/TK 123/)).toBeInTheDocument();
  });

  it("keeps a locked memo closed in lists even when this tab is unlocked", () => {
    mockState.memo = createMemo("# Bank\n\n```memos-lock\nabc\n```");
    mockState.decrypted = { locked: true, plain: "# Bank\n\nTK 123" };
    render(<MemoBody compact={true} />);
    expect(screen.queryByText(/TK 123/)).toBeNull();
    expect(screen.getByText("protect.locked-hint")).toBeInTheDocument();
  });
});

describe("<MemoBody /> compact body clamp", () => {
  it("keeps a buffer between the preview height and the fold trigger", () => {
    expect(CLAMP_TRIGGER_HEIGHT_PX).toBeGreaterThan(CLAMP_PREVIEW_HEIGHT_PX);
  });

  it("folds tall compact bodies into a fixed preview with no in-place expand", async () => {
    // jsdom has no layout; report every element as taller than the fold trigger.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(CLAMP_TRIGGER_HEIGHT_PX + 100);

    mockState.memo = createMemo("line 1\nline 2");
    const { container } = render(<MemoBody compact={true} />);

    // The card opens the memo full screen to read the rest, so the preview has no toggle.
    await waitFor(() => expect(container.querySelector("[data-clamped]")).toHaveStyle({ maxHeight: `${CLAMP_PREVIEW_HEIGHT_PX}px` }));
    expect(screen.queryByRole("button", { name: /memo\.show-(more|less)/ })).toBeNull();
  });

  it("renders no text view for a memo of attachments alone", () => {
    mockState.memo = createMemo("  \n");
    const { rerender } = render(<MemoBody />);
    expect(screen.queryByTestId("memo-text")).not.toBeInTheDocument();

    mockState.memo = createMemo("A caption");
    rerender(<MemoBody />);
    expect(screen.getByTestId("memo-text")).toHaveTextContent("A caption");
  });

  it("renders no clamp when compact is off", () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(CLAMP_TRIGGER_HEIGHT_PX + 100);

    mockState.memo = createMemo("tall content");
    const { container } = render(<MemoBody compact={false} />);

    expect(container.querySelector("[data-clamped]")).toBeNull();
  });

  it("renders the sensitive-content action as a button", () => {
    mockState.blurred = true;
    mockState.memo = createMemo("sensitive content");

    render(<MemoBody compact={false} />);

    const revealButton = screen.getByRole("button", { name: "memo.click-to-show-sensitive-content" });
    expect(revealButton.className).not.toMatch(/ring-/);

    fireEvent.click(revealButton);
    expect(mockState.toggleBlurVisibility).toHaveBeenCalledOnce();
  });

  it("scopes the sensitive-content overlay to the memo body", () => {
    mockState.blurred = true;
    mockState.memo = createMemo("sensitive content");

    render(<MemoBody compact={false} />);

    const revealButton = screen.getByRole("button", { name: "memo.click-to-show-sensitive-content" });
    const memoBody = revealButton.closest('[data-slot="memo-body"]');

    expect(memoBody).not.toBeNull();
    expect(memoBody).toHaveClass("relative", "w-full");
  });

  it("keeps reactions interactive while sensitive content is blurred", () => {
    mockState.blurred = true;
    mockState.memo = createMemo("sensitive content", [{ reactionType: "👍", creator: "users/alice" }]);

    render(<MemoBody compact={false} />);

    const reaction = screen.getByRole("button", { name: "memo-reaction" });
    const blurredContent = screen.getByText("sensitive content").closest(".blur-lg");

    expect(blurredContent).not.toBeNull();
    expect(blurredContent).not.toContainElement(reaction);
    expect(reaction.closest('[data-slot="memo-body"]')).toBeNull();

    fireEvent.click(reaction);
    expect(mockState.reactionClick).toHaveBeenCalledOnce();
  });
});
