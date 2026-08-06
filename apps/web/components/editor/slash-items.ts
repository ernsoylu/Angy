import type { Editor, Range } from "@tiptap/core";
import type { LucideIcon } from "lucide-react";
import {
  Code2,
  Heading2,
  Heading3,
  Info,
  List,
  ListOrdered,
  Minus,
  Table2,
  TextQuote,
  Type,
} from "lucide-react";

export interface SlashItem {
  title: string;
  description: string;
  icon: LucideIcon;
  keywords: string;
  command: (editor: Editor, range: Range) => void;
}

const cell = (type: "tableHeader" | "tableCell") => ({
  type,
  content: [{ type: "paragraph" }],
});

/** Block palette per frontend.pen frame 2 ("Basic blocks"). */
export const SLASH_ITEMS: SlashItem[] = [
  {
    title: "Text",
    description: "Plain paragraph",
    icon: Type,
    keywords: "text paragraph plain",
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("paragraph").run(),
  },
  {
    title: "Heading 2",
    description: "Section title",
    icon: Heading2,
    keywords: "heading h2 section title",
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run(),
  },
  {
    title: "Heading 3",
    description: "Subsection title",
    icon: Heading3,
    keywords: "heading h3 subsection",
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run(),
  },
  {
    title: "Bulleted list",
    description: "Simple list",
    icon: List,
    keywords: "bullet list unordered ul",
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleList("bulletList", "listItem").run(),
  },
  {
    title: "Numbered list",
    description: "Ordered list",
    icon: ListOrdered,
    keywords: "numbered ordered list ol",
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleList("orderedList", "listItem").run(),
  },
  {
    title: "Code block",
    description: "Monospaced, syntax aware",
    icon: Code2,
    keywords: "code monospace pre snippet",
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).setNode("codeBlock").run(),
  },
  {
    title: "Callout",
    description: "Highlight a hard rule",
    icon: Info,
    keywords: "callout note warning info hard rule",
    command: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "callout",
          attrs: { tone: "note" },
          content: [{ type: "paragraph" }],
        })
        .run(),
  },
  {
    title: "Table",
    description: "Rows and columns",
    icon: Table2,
    keywords: "table rows columns grid",
    command: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "table",
          content: [
            { type: "tableRow", content: [cell("tableHeader"), cell("tableHeader")] },
            { type: "tableRow", content: [cell("tableCell"), cell("tableCell")] },
            { type: "tableRow", content: [cell("tableCell"), cell("tableCell")] },
          ],
        })
        .run(),
  },
  {
    title: "Quote",
    description: "Pull quote",
    icon: TextQuote,
    keywords: "quote blockquote",
    command: (editor, range) =>
      editor.chain().focus().deleteRange(range).toggleWrap("blockquote").run(),
  },
  {
    title: "Divider",
    description: "Horizontal rule",
    icon: Minus,
    keywords: "divider rule separator hr",
    command: (editor, range) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "horizontalRule" })
        .run(),
  },
];

export function filterSlashItems(query: string): SlashItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return SLASH_ITEMS.slice(0, 8);
  return SLASH_ITEMS.filter(
    (item) => item.title.toLowerCase().includes(q) || item.keywords.includes(q),
  ).slice(0, 8);
}
