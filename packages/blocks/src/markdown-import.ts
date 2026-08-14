import type { JSONContent } from "@tiptap/core";
import MarkdownIt from "markdown-it";

/**
 * markdown-it ships its own types, so `@types/markdown-it` must NOT be
 * installed — the two declare different `Token` classes and every token array
 * then fails to assign to itself. Derived from the parser's own return type so
 * the two can never drift.
 */
type Token = ReturnType<InstanceType<typeof MarkdownIt>["parse"]>[number];

/**
 * Markdown → ProseMirror JSON (ADR 0005, the *import* direction).
 *
 * One-directional, and the asymmetry is deliberate: this produces a document
 * to build a **fresh** Y.Doc from, never a patch to merge into an existing
 * one. Markdown carries no CRDT tombstones, so merging it back would discard
 * the history concurrent editing depends on — which is why there is import and
 * export but no sync.
 *
 * Produces plain JSON in the schema @angy/blocks already defines, so an
 * imported page reaches storage down the same `createPage(documentJson)` →
 * `initYdoc` path a templated or blank page takes. Import adds no second way
 * for a document to come into existence.
 */

const md = new MarkdownIt("default", { html: false, linkify: true });

/** GitHub task-list syntax, which markdown-it leaves as literal text. */
const TASK_PREFIX = /^\[([ xX])\]\s+/;

interface Cursor {
  tokens: Token[];
  i: number;
}

function inlineChildren(token: Token | undefined): JSONContent[] {
  if (!token?.children) return [];
  const out: JSONContent[] = [];
  const marks: { type: string; attrs?: Record<string, unknown> }[] = [];

  const push = (text: string) => {
    if (!text) return;
    out.push({ type: "text", text, ...(marks.length ? { marks: marks.map((m) => ({ ...m })) } : {}) });
  };

  for (const child of token.children) {
    switch (child.type) {
      case "text":
        push(child.content);
        break;
      case "code_inline":
        out.push({ type: "text", text: child.content, marks: [{ type: "code" }] });
        break;
      case "softbreak":
        // A single newline in Markdown is a space, not a line break.
        push(" ");
        break;
      case "hardbreak":
        out.push({ type: "hardBreak" });
        break;
      case "strong_open":
        marks.push({ type: "bold" });
        break;
      case "em_open":
        marks.push({ type: "italic" });
        break;
      case "s_open":
        marks.push({ type: "strike" });
        break;
      case "link_open":
        marks.push({ type: "link", attrs: { href: child.attrGet("href") ?? "" } });
        break;
      case "strong_close":
      case "em_close":
      case "s_close":
      case "link_close":
        marks.pop();
        break;
      case "image":
        out.push({
          type: "image",
          attrs: { src: child.attrGet("src") ?? "", alt: child.content || null },
        });
        break;
      default:
        // Unknown inline: keep its text rather than dropping content.
        push(child.content);
    }
  }
  return out;
}

/** Consume tokens until the matching close, returning the blocks between. */
function readUntil(cursor: Cursor, closing: string): JSONContent[] {
  const blocks: JSONContent[] = [];
  while (cursor.i < cursor.tokens.length) {
    const token = cursor.tokens[cursor.i]!;
    if (token.type === closing) {
      cursor.i++;
      return blocks;
    }
    const block = readBlock(cursor);
    if (block) blocks.push(...block);
  }
  return blocks;
}

function readTable(cursor: Cursor): JSONContent {
  const rows: JSONContent[] = [];
  let header = false;
  while (cursor.i < cursor.tokens.length) {
    const token = cursor.tokens[cursor.i]!;
    cursor.i++;
    if (token.type === "table_close") break;
    if (token.type === "thead_open") header = true;
    if (token.type === "thead_close") header = false;
    if (token.type !== "tr_open") continue;

    const cells: JSONContent[] = [];
    while (cursor.i < cursor.tokens.length && cursor.tokens[cursor.i]!.type !== "tr_close") {
      const cell = cursor.tokens[cursor.i]!;
      cursor.i++;
      if (cell.type !== "th_open" && cell.type !== "td_open") continue;
      const inline = cursor.tokens[cursor.i];
      if (inline?.type === "inline") cursor.i++;
      cells.push({
        type: header || cell.type === "th_open" ? "tableHeader" : "tableCell",
        content: [{ type: "paragraph", content: inlineChildren(inline) }],
      });
    }
    cursor.i++; // tr_close
    rows.push({ type: "tableRow", content: cells });
  }
  return { type: "table", content: rows };
}

function readList(cursor: Cursor, ordered: boolean): JSONContent {
  const open = cursor.tokens[cursor.i]!;
  cursor.i++;
  const closing = ordered ? "ordered_list_close" : "bullet_list_close";
  const items: JSONContent[] = [];

  while (cursor.i < cursor.tokens.length && cursor.tokens[cursor.i]!.type !== closing) {
    if (cursor.tokens[cursor.i]!.type !== "list_item_open") {
      cursor.i++;
      continue;
    }
    cursor.i++;
    items.push({ type: "listItem", content: readUntil(cursor, "list_item_close") });
  }
  cursor.i++; // list close

  // GitHub checkboxes arrive as literal "[ ] " text at the start of the item.
  // Rewriting them here rather than in a markdown-it plugin keeps the mapping
  // to *our* schema in one place.
  const tasks = items.map((item) => asTaskItem(item)).filter((item) => item !== null);
  if (!ordered && tasks.length === items.length && items.length > 0) {
    return { type: "taskList", content: tasks as JSONContent[] };
  }

  const start = Number(open.attrGet("start") ?? 1);
  return {
    type: ordered ? "orderedList" : "bulletList",
    ...(ordered && start !== 1 ? { attrs: { start } } : {}),
    content: items,
  };
}

/** A list item written as `[ ] text`, converted, or null if it is not one. */
function asTaskItem(item: JSONContent): JSONContent | null {
  const first = item.content?.[0];
  const text = first?.content?.[0];
  if (first?.type !== "paragraph" || text?.type !== "text") return null;
  const match = TASK_PREFIX.exec(text.text ?? "");
  if (!match) return null;

  const stripped = (text.text ?? "").slice(match[0].length);
  const content = [...(first.content ?? [])];
  content[0] = { ...text, text: stripped };
  return {
    type: "taskItem",
    attrs: { checked: match[1]!.toLowerCase() === "x" },
    content: [{ ...first, content }, ...item.content!.slice(1)],
  };
}

function readBlock(cursor: Cursor): JSONContent[] | null {
  const token = cursor.tokens[cursor.i]!;

  switch (token.type) {
    case "heading_open": {
      const level = Math.min(Number(token.tag.slice(1)) || 1, 3);
      const inline = cursor.tokens[cursor.i + 1];
      cursor.i += 3; // open, inline, close
      return [{ type: "heading", attrs: { level }, content: inlineChildren(inline) }];
    }
    case "paragraph_open": {
      const inline = cursor.tokens[cursor.i + 1];
      cursor.i += 3;
      const content = inlineChildren(inline);
      // A paragraph holding only an image is the image block, not a wrapper.
      if (content.length === 1 && content[0]!.type === "image") return [content[0]!];
      return content.length > 0 ? [{ type: "paragraph", content }] : [{ type: "paragraph" }];
    }
    case "fence":
    case "code_block": {
      cursor.i++;
      const language = token.info.trim().split(/\s+/)[0] || null;
      const text = token.content.replace(/\n$/, "");
      return [
        {
          type: "codeBlock",
          ...(language ? { attrs: { language } } : {}),
          ...(text ? { content: [{ type: "text", text }] } : {}),
        },
      ];
    }
    case "hr":
      cursor.i++;
      return [{ type: "horizontalRule" }];
    case "blockquote_open":
      cursor.i++;
      return [{ type: "blockquote", content: readUntil(cursor, "blockquote_close") }];
    case "bullet_list_open":
      return [readList(cursor, false)];
    case "ordered_list_open":
      return [readList(cursor, true)];
    case "table_open":
      cursor.i++;
      return [readTable(cursor)];
    default:
      cursor.i++;
      return null;
  }
}

export interface ImportedDocument {
  /** A leading H1, which is how `documentToMarkdown` writes the page title. */
  title: string | null;
  doc: JSONContent;
}

/**
 * Parse Markdown into a page document.
 *
 * A leading H1 is lifted out as the title rather than left in the body,
 * because that is where the exporter puts it and where every Markdown export
 * of a document keeps its name — leaving it in would give every imported page
 * its own title twice over.
 */
export function markdownToDocument(source: string): ImportedDocument {
  const cursor: Cursor = { tokens: md.parse(source, {}), i: 0 };
  const blocks: JSONContent[] = [];
  while (cursor.i < cursor.tokens.length) {
    const block = readBlock(cursor);
    if (block) blocks.push(...block);
  }

  let title: string | null = null;
  if (blocks[0]?.type === "heading" && blocks[0].attrs?.level === 1) {
    title = textOf(blocks[0]).trim() || null;
    if (title) blocks.shift();
  }

  return {
    title,
    // ProseMirror will not accept an empty doc — an empty file is a blank page.
    doc: { type: "doc", content: blocks.length > 0 ? blocks : [{ type: "paragraph" }] },
  };
}

function textOf(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  return (node.content ?? []).map(textOf).join("");
}
