import type { JSONContent } from "@tiptap/core";

/**
 * Y.Doc → Markdown (ADR 0005, the *export* direction).
 *
 * One-directional by design. Markdown cannot represent a CRDT's tombstones,
 * so a round trip would silently discard the history that makes concurrent
 * editing work — which is why import builds a *fresh* document rather than
 * merging back into an existing one, and why there is no "sync".
 *
 * A pure JSON→string function, like the HTML renderer: no database lookups, so
 * the cached labels a page link or mention carries are what gets written. The
 * projection resolves those before this ever sees them.
 */

/** Nodes that carry no Markdown equivalent are rendered as their text. */
export interface MarkdownOptions {
  /** Absolute base for page links, so an exported file can be read elsewhere. */
  pageLinkBase?: string;
}

const escapeText = (text: string): string =>
  // Only the characters that would start a construct at the point they appear.
  // Escaping everything Markdown *could* use makes ordinary prose unreadable.
  text.replace(/([\\`*_[\]])/g, "\\$1");

function inlineToMarkdown(nodes: JSONContent[] | undefined, options: MarkdownOptions): string {
  if (!nodes) return "";
  return nodes.map((node) => inlineNode(node, options)).join("");
}

function inlineNode(node: JSONContent, options: MarkdownOptions): string {
  if (node.type === "hardBreak") return "  \n";
  if (node.type === "mention") {
    return `@${(node.attrs?.label as string) || "someone"}`;
  }
  if (node.type === "image") {
    const alt = (node.attrs?.alt as string) ?? "";
    return `![${alt}](${(node.attrs?.src as string) ?? ""})`;
  }
  if (node.type !== "text") {
    // An unknown inline node still has to contribute its text, or exporting
    // silently drops content.
    return inlineToMarkdown(node.content, options);
  }

  let text = escapeText(node.text ?? "");
  // Innermost first, so bold(italic(x)) nests as ***x*** rather than **_x_**
  // in the wrong order. `code` wins outright: Markdown does not nest marks
  // inside a code span.
  const marks = node.marks ?? [];
  if (marks.some((m) => m.type === "code")) {
    return `\`${node.text ?? ""}\``;
  }
  for (const mark of marks) {
    if (mark.type === "italic") text = `*${text}*`;
    else if (mark.type === "bold") text = `**${text}**`;
    else if (mark.type === "strike") text = `~~${text}~~`;
    else if (mark.type === "link") text = `[${text}](${(mark.attrs?.href as string) ?? ""})`;
  }
  return text;
}

/** Cell text only — Markdown tables cannot hold block content. */
function cellText(cell: JSONContent, options: MarkdownOptions): string {
  return (cell.content ?? [])
    .map((block) => inlineToMarkdown(block.content, options))
    .join(" ")
    .replace(/\|/g, "\\|")
    .trim();
}

function tableToMarkdown(node: JSONContent, options: MarkdownOptions): string {
  const rows = node.content ?? [];
  if (rows.length === 0) return "";
  const cells = rows.map((row) => (row.content ?? []).map((cell) => cellText(cell, options)));
  const width = Math.max(...cells.map((row) => row.length));
  const pad = (row: string[]) => [...row, ...Array(width - row.length).fill("")];

  const [head, ...body] = cells;
  const lines = [
    `| ${pad(head!).join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...body.map((row) => `| ${pad(row).join(" | ")} |`),
  ];
  return lines.join("\n");
}

function listToMarkdown(node: JSONContent, options: MarkdownOptions): string {
  const ordered = node.type === "orderedList";
  const start = Number(node.attrs?.start ?? 1);
  return (node.content ?? [])
    .map((item, index) => {
      const checked = item.attrs?.checked;
      const bullet =
        typeof checked === "boolean"
          ? `- [${checked ? "x" : " "}] `
          : ordered
            ? `${start + index}. `
            : "- ";
      const body = blocksToMarkdown(item.content, options);
      // Continuation lines align under the bullet, which is what keeps a
      // nested list a child rather than a sibling. Indentation comes *only*
      // from here: a nested list that also indented itself would compound with
      // its parent's prefix and drift two spaces deeper per level.
      const [first = "", ...rest] = body.split("\n");
      return [`${bullet}${first}`, ...rest.map((line) => (line ? `  ${line}` : ""))].join("\n");
    })
    .join("\n");
}

function blockToMarkdown(node: JSONContent, options: MarkdownOptions): string {
  switch (node.type) {
    case "paragraph":
      return inlineToMarkdown(node.content, options);
    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      return `${"#".repeat(level)} ${inlineToMarkdown(node.content, options)}`;
    }
    case "codeBlock": {
      const language = (node.attrs?.language as string) ?? "";
      const body = (node.content ?? []).map((child) => child.text ?? "").join("");
      return `\`\`\`${language}\n${body}\n\`\`\``;
    }
    case "blockquote":
      return blocksToMarkdown(node.content, options)
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
    case "callout": {
      // No Markdown equivalent, so it degrades to a blockquote with its title
      // in bold — readable everywhere, and it keeps the words.
      const title = node.attrs?.title as string | null;
      const inner = blocksToMarkdown(node.content, options);
      const lines = title ? [`**${title}**`, "", inner] : [inner];
      return lines
        .join("\n")
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
    }
    case "bulletList":
    case "orderedList":
    case "taskList":
      return listToMarkdown(node, options);
    case "horizontalRule":
    case "divider":
      return "---";
    case "table":
      return tableToMarkdown(node, options);
    case "image":
      return `![${(node.attrs?.alt as string) ?? ""}](${(node.attrs?.src as string) ?? ""})`;
    case "pageLink": {
      const title = (node.attrs?.title as string) || "Untitled";
      const base = options.pageLinkBase ?? "/p";
      return `[${title}](${base}/${(node.attrs?.pageId as string) ?? ""})`;
    }
    default:
      // Unknown block: keep its text rather than dropping it silently. An
      // exporter that loses content is worse than one that loses formatting.
      return node.content ? blocksToMarkdown(node.content, options) : "";
  }
}

function blocksToMarkdown(nodes: JSONContent[] | undefined, options: MarkdownOptions): string {
  return (nodes ?? [])
    .map((node) => blockToMarkdown(node, options))
    .filter((block) => block !== "")
    .join("\n\n");
}

/**
 * Render a page's document to Markdown.
 *
 * `title` becomes an H1, because a Markdown file without one loses the page's
 * name entirely — the title lives on the page row and in the Y.Doc's `title`
 * field, neither of which is part of the body.
 */
export function documentToMarkdown(
  doc: JSONContent,
  title?: string,
  options: MarkdownOptions = {},
): string {
  const body = blocksToMarkdown(doc.content, options);
  const head = title ? `# ${title}` : "";
  return [head, body].filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
