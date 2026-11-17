import { Extension } from "@tiptap/core";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { TextSelection } from "@tiptap/pm/state";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { collectTags, parseMemoMarkdown } from "@/lib/memo-markdown";
import { cn } from "@/lib/utils";
import { isCompleteTagValue } from "@/utils/tag-grammar";
import type { EditorFileOrigin } from "../extensions";
import type { EditorController } from "../types/editorController";
import { ClassicToolbar } from "./ClassicToolbar";
import { Column, Columns } from "./columns";
import { htmlToMarkdown, markdownToHtml } from "./markdown";
import "./classic.css";

export interface ClassicEditorProps {
  className?: string;
  /** The document as Markdown. Applied only when it is not a value the editor emitted itself. */
  value: string;
  placeholder: string;
  onContentChange: (content: string) => void;
  onFiles: (files: File[], origin: EditorFileOrigin) => void;
  /** Cmd/Ctrl+Enter. */
  onSubmit: () => void;
  isFocusMode?: boolean;
}

const filesOf = (data: DataTransfer | null): File[] => Array.from(data?.files ?? []);

/** Where a block inserted for the caret goes: after the caret's top-level block, or in place of it when it is empty. */
const blockInsertRange = (editor: Editor, at: number): { from: number; to: number } => {
  const { doc } = editor.state;
  const $pos = doc.resolve(Math.min(Math.max(at, 0), doc.content.size));
  if ($pos.depth < 1) return { from: $pos.pos, to: $pos.pos };
  const block = $pos.node(1);
  const start = $pos.before(1);
  const end = $pos.after(1);
  const isEmptyParagraph = block.type.name === "paragraph" && block.content.size === 0;
  return isEmptyParagraph ? { from: start, to: end } : { from: end, to: end };
};

/**
 * The classic (WordPress-style) editor: a fixed toolbar over a TipTap document. It reads
 * and writes the memo's Markdown (see markdown.ts) and implements EditorController, so the
 * composer's chrome (uploads, tags, suggestions, save) works unchanged.
 */
const ClassicEditor = forwardRef(function ClassicEditor(props: ClassicEditorProps, ref: React.ForwardedRef<EditorController>) {
  const { className, value, placeholder, onContentChange, onFiles, onSubmit, isFocusMode } = props;
  const callbacks = useRef({ onContentChange, onFiles, onSubmit });
  useLayoutEffect(() => {
    callbacks.current = { onContentChange, onFiles, onSubmit };
  });
  /** The Markdown the document currently stands for; a `value` equal to it is not re-applied. */
  const markdownRef = useRef(value);
  /** Upload placeholders: the document position each upload lands at, mapped through every edit. */
  const anchorsRef = useRef(new Map<string, number>());

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      }),
      TextStyleKit.configure({ lineHeight: false }),
      TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Image.configure({ inline: false, allowBase64: false }),
      Columns,
      Column,
      Placeholder.configure({ placeholder }),
      Extension.create({
        name: "memoKeys",
        addKeyboardShortcuts: () => ({
          "Mod-Enter": () => {
            callbacks.current.onSubmit();
            return true;
          },
        }),
      }),
    ],
    // The editor keeps its extensions for its lifetime; the placeholder is read once.
    [],
  );

  const editor = useEditor({
    extensions,
    content: markdownToHtml(value),
    editorProps: {
      attributes: {
        class: "classic-editor-content",
        autocorrect: "on",
        autocapitalize: "on",
        spellcheck: "true",
      },
      handlePaste: (_view, event) => {
        const files = filesOf(event.clipboardData);
        if (!files.length) return false;
        callbacks.current.onFiles(files, { source: "paste" });
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = filesOf((event as DragEvent).dataTransfer);
        if (moved || !files.length) return false;
        event.preventDefault();
        // The upload lands where the files were dropped.
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        if (pos !== undefined) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
        callbacks.current.onFiles(files, { source: "drop", position: null });
        return true;
      },
    },
    onUpdate: ({ editor: instance }) => {
      const markdown = htmlToMarkdown(instance.getHTML());
      if (markdown === markdownRef.current) return;
      markdownRef.current = markdown;
      callbacks.current.onContentChange(markdown);
    },
    onTransaction: ({ transaction }) => {
      if (!transaction.docChanged) return;
      for (const [id, pos] of anchorsRef.current) anchorsRef.current.set(id, transaction.mapping.map(pos));
    },
  });

  // A value from outside (a restored draft, a reset after saving) replaces the document.
  useEffect(() => {
    if (!editor || editor.isDestroyed || value === markdownRef.current) return;
    markdownRef.current = value;
    editor.commands.setContent(markdownToHtml(value), { emitUpdate: false });
  }, [editor, value]);

  const insertMarkdownAt = (instance: Editor, markdown: string, at: number) => {
    const html = markdownToHtml(markdown);
    if (!html) return;
    const range = blockInsertRange(instance, at);
    instance.chain().focus().insertContentAt(range, html).scrollIntoView().run();
  };

  const controller = useMemo<EditorController>(() => {
    const live = () => (editor && !editor.isDestroyed ? editor : null);
    const currentMarkdown = () => {
      const instance = live();
      return instance ? htmlToMarkdown(instance.getHTML()) : markdownRef.current;
    };
    const blocks = () => parseMemoMarkdown(currentMarkdown()).blocks;
    return {
      focus: () => live()?.commands.focus(),
      hasFocus: () => live()?.isFocused ?? false,
      isEmpty: () => currentMarkdown().trim() === "",
      getMarkdown: currentMarkdown,
      setMarkdown: (markdown) => {
        const instance = live();
        if (!instance) return;
        markdownRef.current = markdown;
        instance.commands.setContent(markdownToHtml(markdown), { emitUpdate: false });
        callbacks.current.onContentChange(markdown);
      },
      insertMarkdown: (markdown) => {
        const instance = live();
        if (!instance || !markdown) return;
        insertMarkdownAt(instance, markdown, instance.state.selection.to);
      },
      getTags: () => collectTags(blocks()),
      hasChecklist: () => blocks().some((block) => block.type === "listItem" && block.listType === "task"),
      insertTag: (tag) => {
        const instance = live();
        if (!instance || !isCompleteTagValue(tag) || collectTags(blocks()).includes(tag)) return false;
        const { from, to } = instance.state.selection;
        const before = instance.state.doc.textBetween(Math.max(0, from - 1), from);
        instance
          .chain()
          .focus()
          .insertContentAt(to, `${before && !/\s/.test(before) ? " " : ""}#${tag} `)
          .scrollIntoView()
          .run();
        return true;
      },
      createUploadAnchor: (descriptor) => {
        const instance = live();
        if (instance) anchorsRef.current.set(descriptor.id, instance.state.selection.to);
      },
      updateUploadAnchor: () => {},
      resolveUploadAnchor: (id, markdown) => {
        const instance = live();
        const pos = anchorsRef.current.get(id);
        anchorsRef.current.delete(id);
        if (!instance || pos === undefined || !markdown) return;
        insertMarkdownAt(instance, markdown, pos);
      },
      cancelUploadAnchor: (id) => {
        anchorsRef.current.delete(id);
      },
      // The caret is not cached across mounts: the memo editor's selection format does not apply here.
      getSelection: () => undefined,
      setSelection: () => {},
      selectAll: () => live()?.commands.selectAll(),
      toggleTaskList: () => live()?.chain().focus().toggleTaskList().run() ?? false,
    };
  }, [editor]);
  useImperativeHandle(ref, () => controller, [controller]);

  if (!editor) return null;

  return (
    <div className={cn("classic-editor flex w-full flex-col gap-2", isFocusMode && "min-h-0 flex-1", className)}>
      <ClassicToolbar editor={editor} onPickImages={(files) => callbacks.current.onFiles(files, { source: "drop", position: null })} />
      <div className={cn("w-full text-base leading-6", isFocusMode ? "min-h-0 flex-1 overflow-y-auto" : "max-h-[70vh] overflow-y-auto")}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
});

export default ClassicEditor;
