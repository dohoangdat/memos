import { create } from "@bufbuild/protobuf";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MemoView from "@/components/MemoView/MemoView";
import { MemoSchema } from "@/types/proto/api/memo_service_pb";

const mocks = vi.hoisted(() => ({ canManage: true }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ userTagsSetting: undefined }) }));
vi.mock("@/contexts/MentionResolutionContext", () => ({ useResolvedUser: () => undefined }));
vi.mock("@/hooks/useCurrentUser", () => ({ default: () => ({ name: "users/1" }) }));
vi.mock("@/utils/user", () => ({ canManageMemo: () => mocks.canManage }));
// The tag line at the foot of a list card reads protection state from the server; not under test here.
vi.mock("@/components/MemoView/components/MemoTagLine", () => ({ default: () => null }));
vi.mock("@/components/MemoView/components", () => ({
  MemoHeader: () => <div>header</div>,
  MemoBody: () => (
    <div>
      <p>memo text</p>
      <a href="#elsewhere">a link</a>
    </div>
  ),
  MemoCommentListView: () => null,
}));
vi.mock("@/components/MemoView/MemoFullscreen", () => ({
  MemoReaderDialog: () => <div>full-screen reader</div>,
  MemoEditDialog: () => <div>full-screen editor</div>,
}));

const memo = create(MemoSchema, { name: "memos/1", content: "memo text" });

const renderCard = (compact = true) =>
  render(
    <MemoryRouter>
      <MemoView memo={memo} compact={compact} />
    </MemoryRouter>,
  );

const card = () => screen.getByText("memo text").closest("article") as HTMLElement;

beforeEach(() => {
  mocks.canManage = true;
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MemoView full-screen read and edit", () => {
  it("opens the reader on a click, after waiting for a possible second click", async () => {
    renderCard();
    fireEvent.click(screen.getByText("memo text"), { detail: 1 });
    expect(screen.queryByText("full-screen reader")).toBeNull();

    await act(async () => vi.advanceTimersByTime(300));
    expect(await screen.findByText("full-screen reader")).toBeInTheDocument();
    expect(screen.queryByText("full-screen editor")).toBeNull();
  });

  it("opens the editor, not the reader, on a double click", async () => {
    renderCard();
    const text = screen.getByText("memo text");
    fireEvent.click(text, { detail: 1 });
    fireEvent.click(text, { detail: 2 });
    fireEvent.doubleClick(text);

    expect(await screen.findByText("full-screen editor")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.queryByText("full-screen reader")).toBeNull();
  });

  it("opens the reader at once on a tap", async () => {
    renderCard();
    fireEvent.pointerDown(card(), { pointerType: "touch" });
    fireEvent.click(screen.getByText("memo text"), { detail: 1 });
    expect(await screen.findByText("full-screen reader")).toBeInTheDocument();
  });

  it("leaves links and other controls to themselves", async () => {
    renderCard();
    fireEvent.click(screen.getByText("a link"), { detail: 1 });
    fireEvent.doubleClick(screen.getByText("a link"));
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.queryByText("full-screen reader")).toBeNull();
    expect(screen.queryByText("full-screen editor")).toBeNull();
  });

  it("lets someone who cannot edit read, but not edit", async () => {
    mocks.canManage = false;
    renderCard();
    fireEvent.doubleClick(screen.getByText("memo text"));
    fireEvent.click(screen.getByText("memo text"), { detail: 1 });
    expect(await screen.findByText("full-screen reader")).toBeInTheDocument();
    expect(screen.queryByText("full-screen editor")).toBeNull();
  });

  it("opens the reader from the keyboard", async () => {
    renderCard();
    fireEvent.keyDown(card(), { key: "Enter" });
    expect(await screen.findByText("full-screen reader")).toBeInTheDocument();
  });

  it("does not open a reader for a memo already shown in full", async () => {
    renderCard(false);
    fireEvent.click(screen.getByText("memo text"), { detail: 1 });
    await act(async () => vi.advanceTimersByTime(300));
    expect(screen.queryByText("full-screen reader")).toBeNull();
    // Editing still opens full screen.
    fireEvent.doubleClick(screen.getByText("memo text"));
    expect(await screen.findByText("full-screen editor")).toBeInTheDocument();
  });
});
