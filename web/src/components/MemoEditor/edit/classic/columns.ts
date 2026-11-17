import { type CommandProps, mergeAttributes, Node } from "@tiptap/core";

export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 4;

const clampCount = (count: number) => Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, Math.round(count) || MIN_COLUMNS));

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columns: {
      /** Inserts a row of `count` columns, the first holding the current block's content. */
      setColumns: (count: number) => ReturnType;
      /** Changes how many columns the surrounding row has, keeping the content. */
      setColumnCount: (count: number) => ReturnType;
      /** Replaces the surrounding row with its columns' content, one after another. */
      unsetColumns: () => ReturnType;
    };
  }
}

/** One column of a row. Holds ordinary blocks. */
export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,
  defining: true,
  parseHTML: () => [{ tag: "div.wpc-column" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes(HTMLAttributes, { class: "wpc-column" }), 0],
});

/** A row of 2–4 equal columns, stored as `<div class="wpc-columns wpc-cols-N">`. */
export const Columns = Node.create({
  name: "columns",
  group: "block",
  content: "column{2,4}",
  isolating: true,
  defining: true,
  addAttributes: () => ({
    count: {
      default: MIN_COLUMNS,
      parseHTML: (element) => clampCount(element.querySelectorAll(":scope > .wpc-column").length),
      renderHTML: () => ({}),
    },
  }),
  parseHTML: () => [{ tag: "div.wpc-columns" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { class: `wpc-columns wpc-cols-${node.childCount}` }),
    0,
  ],

  addCommands() {
    const findRow = ({ state }: CommandProps) => {
      const { $from } = state.selection;
      for (let depth = $from.depth; depth > 0; depth--) {
        const node = $from.node(depth);
        if (node.type.name === this.name) return { node, pos: $from.before(depth) };
      }
      return null;
    };

    return {
      setColumns:
        (count) =>
        ({ state, tr, dispatch }) => {
          const n = clampCount(count);
          const { schema } = state;
          const { $from } = state.selection;
          if ($from.depth < 1) return false;
          // Never nest a row inside another row's column.
          for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type.name === this.name) return false;
          const block = $from.node(1);
          const from = $from.before(1);
          const to = $from.after(1);
          const empty = () => schema.nodes.paragraph.create();
          const first = block.type.name === "paragraph" && block.content.size === 0 ? empty() : block;
          const columns = Array.from({ length: n }, (_, index) => schema.nodes.column.create(null, index === 0 ? first : empty()));
          if (dispatch) tr.replaceWith(from, to, schema.nodes.columns.create({ count: n }, columns));
          return true;
        },
      setColumnCount: (count) => (props) => {
        const row = findRow(props);
        if (!row) return false;
        const n = clampCount(count);
        const { schema } = props.state;
        const children: ReturnType<typeof schema.nodes.column.create>[] = [];
        row.node.forEach((child) => {
          children.push(child);
        });
        if (n > children.length) {
          while (children.length < n) children.push(schema.nodes.column.create(null, schema.nodes.paragraph.create()));
        } else if (n < children.length) {
          // Removed columns' content moves into the last kept column.
          const kept = children.slice(0, n);
          const extra = children.slice(n).flatMap((column) => {
            const blocks: (typeof column)[] = [];
            column.forEach((block) => {
              blocks.push(block);
            });
            return blocks;
          });
          const last = kept[n - 1];
          const lastBlocks: (typeof last)[] = [];
          last.forEach((block) => {
            lastBlocks.push(block);
          });
          kept[n - 1] = schema.nodes.column.create(last.attrs, [...lastBlocks, ...extra]);
          children.splice(0, children.length, ...kept);
        }
        if (props.dispatch) {
          props.tr.replaceWith(row.pos, row.pos + row.node.nodeSize, schema.nodes.columns.create({ count: n }, children));
        }
        return true;
      },
      unsetColumns: () => (props) => {
        const row = findRow(props);
        if (!row) return false;
        const blocks: ReturnType<typeof props.state.schema.nodes.paragraph.create>[] = [];
        row.node.forEach((column) => {
          column.forEach((block) => {
            const isEmpty = block.type.name === "paragraph" && block.content.size === 0;
            if (!isEmpty) blocks.push(block);
          });
        });
        if (!blocks.length) blocks.push(props.state.schema.nodes.paragraph.create());
        if (props.dispatch) props.tr.replaceWith(row.pos, row.pos + row.node.nodeSize, blocks);
        return true;
      },
    };
  },
});
