import { type Editor, useEditorState } from "@tiptap/react";
import { Menu, Popover } from "@usememos/ui";
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BaselineIcon,
  BoldIcon,
  ChevronDownIcon,
  CodeIcon,
  Columns2Icon,
  HighlighterIcon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  QuoteIcon,
  Redo2Icon,
  RemoveFormattingIcon,
  StrikethroughIcon,
  TableIcon,
  UnderlineIcon,
  Undo2Icon,
  UnlinkIcon,
} from "lucide-react";
import { type ReactNode, useRef } from "react";
import { useLocalStorage } from "@/hooks";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { MAX_COLUMNS, MIN_COLUMNS } from "./columns";
import { COLOR_PALETTE, FONT_FAMILIES, FONT_SIZES, primaryFamily } from "./fonts";

interface ClassicToolbarProps {
  editor: Editor;
  /** Images chosen with the toolbar's image button; uploaded and inserted at the caret. */
  onPickImages: (files: File[]) => void;
}

const BLOCK_FORMATS = ["paragraph", "h1", "h2", "h3", "h4", "codeBlock"] as const;
type BlockFormat = (typeof BLOCK_FORMATS)[number];

const controlClass = "h-8 rounded-mu-md border border-mu-line bg-mu-surface px-1.5 mu-body text-mu-text mu-focus";

const ToolButton = (props: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    title={props.label}
    aria-label={props.label}
    aria-pressed={props.active}
    disabled={props.disabled}
    // Keep the editor's selection: a toolbar click must not take focus first.
    onMouseDown={(event) => event.preventDefault()}
    onClick={props.onClick}
    className={cn(
      "inline-flex size-8 shrink-0 items-center justify-center rounded-mu-md text-mu-text-secondary transition-colors [&_svg]:size-4",
      "hover:bg-mu-well hover:text-mu-text disabled:pointer-events-none disabled:opacity-40",
      props.active && "bg-mu-well text-mu-text",
    )}
  >
    {props.children}
  </button>
);

const Divider = () => <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-mu-line" />;

const ColorPicker = (props: { editor: Editor; kind: "color" | "background"; label: string; current?: string; icon: ReactNode }) => {
  const t = useTranslate();
  const { editor, kind } = props;
  const apply = (color: string) => {
    const chain = editor.chain().focus();
    (kind === "color" ? chain.setColor(color) : chain.setBackgroundColor(color)).run();
  };
  const clear = () => {
    const chain = editor.chain().focus();
    (kind === "color" ? chain.unsetColor() : chain.unsetBackgroundColor()).run();
  };
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <button
            type="button"
            title={props.label}
            aria-label={props.label}
            onMouseDown={(event) => event.preventDefault()}
            className="inline-flex size-8 shrink-0 flex-col items-center justify-center gap-0.5 rounded-mu-md text-mu-text-secondary hover:bg-mu-well hover:text-mu-text [&_svg]:size-4"
          />
        }
      >
        {props.icon}
        <span className="h-1 w-4 rounded-full border border-mu-line" style={{ backgroundColor: props.current ?? "transparent" }} />
      </Popover.Trigger>
      <Popover.Popup align="start" className="w-auto">
        <div className="flex w-44 flex-col gap-2">
          <div className="grid grid-cols-6 gap-1.5">
            {COLOR_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                aria-label={color}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => apply(color)}
                className={cn(
                  "size-6 rounded-mu-sm border border-mu-line",
                  props.current?.toLowerCase() === color && "outline-2 outline-offset-1 outline-mu-accent",
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <label className="flex items-center justify-between gap-2 mu-body text-mu-text-secondary">
            {t("editor.classic.custom-color")}
            <input
              type="color"
              className="h-7 w-10 cursor-pointer rounded-mu-sm border border-mu-line bg-transparent"
              value={props.current && /^#[0-9a-f]{6}$/i.test(props.current) ? props.current : "#000000"}
              onChange={(event) => apply(event.target.value)}
            />
          </label>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={clear}
            className="rounded-mu-md px-2 py-1 text-start mu-body text-mu-text-secondary hover:bg-mu-well hover:text-mu-text"
          >
            {t("editor.classic.clear-color")}
          </button>
        </div>
      </Popover.Popup>
    </Popover.Root>
  );
};

/**
 * The classic editor's fixed toolbar, laid out like WordPress's classic editor: one line of
 * everyday tools, and a toggle that shows a second row with the rest.
 */
export const ClassicToolbar = ({ editor, onPickImages }: ClassicToolbarProps) => {
  const t = useTranslate();
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Whether the second row of less used tools shows; remembered on this device.
  const [expanded, setExpanded] = useLocalStorage<boolean>("classic-toolbar-expanded", false);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const heading = [1, 2, 3, 4].find((level) => e.isActive("heading", { level }));
      const format: BlockFormat = e.isActive("codeBlock") ? "codeBlock" : heading ? (`h${heading}` as BlockFormat) : "paragraph";
      const textStyle = e.getAttributes("textStyle") as {
        fontFamily?: string;
        fontSize?: string;
        color?: string;
        backgroundColor?: string;
      };
      const align = (["center", "right", "justify"] as const).find((value) => e.isActive({ textAlign: value })) ?? "left";
      return {
        format,
        fontFamily: primaryFamily(textStyle.fontFamily),
        fontSize: textStyle.fontSize ?? "",
        color: textStyle.color,
        backgroundColor: textStyle.backgroundColor,
        align,
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        code: e.isActive("code"),
        bulletList: e.isActive("bulletList"),
        orderedList: e.isActive("orderedList"),
        taskList: e.isActive("taskList"),
        blockquote: e.isActive("blockquote"),
        link: e.isActive("link"),
        inTable: e.isActive("table"),
        inColumns: e.isActive("columns"),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      };
    },
  });

  const setFormat = (format: BlockFormat) => {
    const chain = editor.chain().focus();
    if (format === "paragraph") chain.setParagraph().run();
    else if (format === "codeBlock") chain.toggleCodeBlock().run();
    else chain.setHeading({ level: Number(format.slice(1)) as 1 | 2 | 3 | 4 }).run();
  };

  const setFontFamily = (value: string) => {
    const chain = editor.chain().focus();
    (value ? chain.setFontFamily(value) : chain.unsetFontFamily()).run();
  };

  const setFontSize = (value: string) => {
    const chain = editor.chain().focus();
    (value ? chain.setFontSize(value) : chain.unsetFontSize()).run();
  };

  const editLink = () => {
    const previous = (editor.getAttributes("link").href as string | undefined) ?? "https://";
    const url = window.prompt(t("editor.classic.link-prompt"), previous);
    if (url === null) return;
    const chain = editor.chain().focus().extendMarkRange("link");
    (url.trim() ? chain.setLink({ href: url.trim() }) : chain.unsetLink()).run();
  };

  const align = (value: "left" | "center" | "right" | "justify") => {
    const chain = editor.chain().focus();
    (value === "left" ? chain.unsetTextAlign() : chain.setTextAlign(value)).run();
  };

  return (
    <div
      role="toolbar"
      aria-label={t("editor.classic.toolbar")}
      className="sticky top-0 z-10 -mx-1 flex flex-col gap-0.5 rounded-mu-md border border-mu-line bg-mu-surface/95 p-1 backdrop-blur"
    >
      {/* The tools used every day, on one line; the toggle shows the rest, as in WordPress. */}
      <div className="flex items-center gap-0.5">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]">
          <select
            aria-label={t("editor.classic.block-format")}
            title={t("editor.classic.block-format")}
            className={cn(controlClass, "w-32")}
            value={state.format}
            onChange={(event) => setFormat(event.target.value as BlockFormat)}
          >
            <option value="paragraph">{t("editor.classic.paragraph")}</option>
            <option value="h1">{t("editor.classic.heading", { level: 1 })}</option>
            <option value="h2">{t("editor.classic.heading", { level: 2 })}</option>
            <option value="h3">{t("editor.classic.heading", { level: 3 })}</option>
            <option value="h4">{t("editor.classic.heading", { level: 4 })}</option>
            <option value="codeBlock">{t("editor.classic.code-block")}</option>
          </select>
          <ToolButton label={t("editor.classic.bold")} active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
            <BoldIcon />
          </ToolButton>
          <ToolButton label={t("editor.classic.italic")} active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <ItalicIcon />
          </ToolButton>
          <ToolButton
            label={t("editor.classic.underline")}
            active={state.underline}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            <UnderlineIcon />
          </ToolButton>
          <Divider />
          <ToolButton
            label={t("editor.classic.bullet-list")}
            active={state.bulletList}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <ListIcon />
          </ToolButton>
          <ToolButton
            label={t("editor.classic.ordered-list")}
            active={state.orderedList}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrderedIcon />
          </ToolButton>
          <ToolButton
            label={t("editor.classic.task-list")}
            active={state.taskList}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          >
            <ListChecksIcon />
          </ToolButton>
          <Divider />
          <ToolButton label={t("editor.classic.link")} active={state.link} onClick={editLink}>
            <LinkIcon />
          </ToolButton>
          <ToolButton label={t("editor.classic.image")} onClick={() => imageInputRef.current?.click()}>
            <ImageIcon />
          </ToolButton>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length) onPickImages(files);
            }}
          />
        </div>
        <ToolButton label={expanded ? t("common.collapse") : t("common.expand")} active={expanded} onClick={() => setExpanded(!expanded)}>
          <ChevronDownIcon className={cn("transition-transform", expanded && "rotate-180")} />
        </ToolButton>
      </div>

      {expanded && (
        <div className="flex flex-wrap items-center gap-0.5 border-t border-mu-line pt-1">
          <ToolButton label={t("editor.classic.undo")} disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}>
            <Undo2Icon />
          </ToolButton>
          <ToolButton label={t("editor.classic.redo")} disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}>
            <Redo2Icon />
          </ToolButton>
          <Divider />
          <select
            aria-label={t("editor.classic.font-family")}
            title={t("editor.classic.font-family")}
            className={cn(controlClass, "w-36")}
            value={FONT_FAMILIES.find((font) => primaryFamily(font.value) === state.fontFamily)?.value ?? ""}
            onChange={(event) => setFontFamily(event.target.value)}
          >
            <option value="">{t("editor.classic.default-font")}</option>
            {FONT_FAMILIES.map((font) => (
              <option key={font.value} value={font.value} style={{ fontFamily: font.value }}>
                {font.label}
              </option>
            ))}
          </select>
          <select
            aria-label={t("editor.classic.font-size")}
            title={t("editor.classic.font-size")}
            className={cn(controlClass, "w-24")}
            value={FONT_SIZES.includes(state.fontSize) ? state.fontSize : ""}
            onChange={(event) => setFontSize(event.target.value)}
          >
            <option value="">{t("editor.classic.default-size")}</option>
            {FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <Divider />
          <ToolButton label={t("editor.classic.strike")} active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <StrikethroughIcon />
          </ToolButton>
          <ToolButton label={t("editor.classic.inline-code")} active={state.code} onClick={() => editor.chain().focus().toggleCode().run()}>
            <CodeIcon />
          </ToolButton>
          <ColorPicker editor={editor} kind="color" label={t("editor.classic.text-color")} current={state.color} icon={<BaselineIcon />} />
          <ColorPicker
            editor={editor}
            kind="background"
            label={t("editor.classic.highlight")}
            current={state.backgroundColor}
            icon={<HighlighterIcon />}
          />
          <Divider />
          <ToolButton label={t("editor.classic.align-left")} active={state.align === "left"} onClick={() => align("left")}>
            <AlignLeftIcon />
          </ToolButton>
          <ToolButton label={t("editor.classic.align-center")} active={state.align === "center"} onClick={() => align("center")}>
            <AlignCenterIcon />
          </ToolButton>
          <ToolButton label={t("editor.classic.align-right")} active={state.align === "right"} onClick={() => align("right")}>
            <AlignRightIcon />
          </ToolButton>
          <ToolButton label={t("editor.classic.align-justify")} active={state.align === "justify"} onClick={() => align("justify")}>
            <AlignJustifyIcon />
          </ToolButton>
          <Divider />
          <ToolButton
            label={t("editor.classic.blockquote")}
            active={state.blockquote}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <QuoteIcon />
          </ToolButton>
          <ToolButton label={t("editor.classic.divider")} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
            <MinusIcon />
          </ToolButton>
          <Divider />
          <ToolButton label={t("editor.classic.unlink")} disabled={!state.link} onClick={() => editor.chain().focus().unsetLink().run()}>
            <UnlinkIcon />
          </ToolButton>
          <Menu.Root modal={false} size="md">
            <Menu.Trigger
              render={
                <button
                  type="button"
                  title={t("editor.classic.table")}
                  aria-label={t("editor.classic.table")}
                  onMouseDown={(event) => event.preventDefault()}
                  className={cn(
                    "inline-flex size-8 shrink-0 items-center justify-center rounded-mu-md text-mu-text-secondary hover:bg-mu-well hover:text-mu-text [&_svg]:size-4",
                    state.inTable && "bg-mu-well text-mu-text",
                  )}
                />
              }
            >
              <TableIcon />
            </Menu.Trigger>
            <Menu.Popup align="start">
              <Menu.Item
                disabled={state.inTable}
                onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
              >
                {t("editor.classic.insert-table")}
              </Menu.Item>
              <Menu.Separator />
              <Menu.Item disabled={!state.inTable} onClick={() => editor.chain().focus().addRowAfter().run()}>
                {t("editor.classic.add-row")}
              </Menu.Item>
              <Menu.Item disabled={!state.inTable} onClick={() => editor.chain().focus().addColumnAfter().run()}>
                {t("editor.classic.add-column")}
              </Menu.Item>
              <Menu.Item disabled={!state.inTable} onClick={() => editor.chain().focus().deleteRow().run()}>
                {t("editor.classic.delete-row")}
              </Menu.Item>
              <Menu.Item disabled={!state.inTable} onClick={() => editor.chain().focus().deleteColumn().run()}>
                {t("editor.classic.delete-column")}
              </Menu.Item>
              <Menu.Item disabled={!state.inTable} onClick={() => editor.chain().focus().mergeOrSplit().run()}>
                {t("editor.classic.merge-cells")}
              </Menu.Item>
              <Menu.Item disabled={!state.inTable} onClick={() => editor.chain().focus().deleteTable().run()}>
                {t("editor.classic.delete-table")}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Root>

          <Menu.Root modal={false} size="md">
            <Menu.Trigger
              render={
                <button
                  type="button"
                  title={t("editor.classic.columns")}
                  aria-label={t("editor.classic.columns")}
                  onMouseDown={(event) => event.preventDefault()}
                  className={cn(
                    "inline-flex size-8 shrink-0 items-center justify-center rounded-mu-md text-mu-text-secondary hover:bg-mu-well hover:text-mu-text [&_svg]:size-4",
                    state.inColumns && "bg-mu-well text-mu-text",
                  )}
                />
              }
            >
              <Columns2Icon />
            </Menu.Trigger>
            <Menu.Popup align="start">
              {Array.from({ length: MAX_COLUMNS - MIN_COLUMNS + 1 }, (_, index) => MIN_COLUMNS + index).map((count) => (
                <Menu.Item
                  key={count}
                  onClick={() =>
                    state.inColumns ? editor.chain().focus().setColumnCount(count).run() : editor.chain().focus().setColumns(count).run()
                  }
                >
                  {t("editor.classic.column-count", { n: count })}
                </Menu.Item>
              ))}
              <Menu.Separator />
              <Menu.Item disabled={!state.inColumns} onClick={() => editor.chain().focus().unsetColumns().run()}>
                {t("editor.classic.remove-columns")}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Root>
          <Divider />

          <ToolButton
            label={t("editor.classic.clear-formatting")}
            onClick={() => editor.chain().focus().unsetAllMarks().unsetTextAlign().run()}
          >
            <RemoveFormattingIcon />
          </ToolButton>
        </div>
      )}
    </div>
  );
};
