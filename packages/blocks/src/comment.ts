import { Mark, mergeAttributes } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";

/**
 * The anchor of a comment thread (V2 H5.2, ADR 0014).
 *
 * A mark, not a node and not a stored offset, because a mark *is* a position
 * expressed in the only coordinate system that survives concurrent editing:
 * the text itself. Yjs moves it with the characters it covers, splits it when
 * someone types into the middle, and drops it when the text is deleted — which
 * is the whole anchoring problem, solved by the CRDT rather than by repair
 * logic of our own.
 *
 * It carries nothing but a thread id. Everything else about the conversation
 * is relational, so replying and resolving are not edits to the document.
 */
export const CommentMark = Mark.create({
  name: "comment",

  /**
   * Typing at either end of a commented range must not extend the comment over
   * the new text — the remark was about what was there.
   */
  inclusive: false,

  /**
   * Marks of one type exclude themselves by default, which would make two
   * people commenting on overlapping sentences a conflict. Overlapping threads
   * are ordinary in review, and ProseMirror nests the marks happily.
   */
  excludes: "",

  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-thread-id"),
        renderHTML: (attributes) => ({ "data-thread-id": attributes.threadId as string }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "mark[data-thread-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes, { class: "comment-anchor" }), 0];
  },
});

/**
 * Every thread id anchored in a document, in document order and deduplicated.
 *
 * The projection worker compares this against the threads on record: one that
 * is no longer here had its text deleted, and is flagged rather than dropped —
 * the sentence is gone, the conversation about it usually still matters. The
 * reverse case matters too, since an undo can bring the text back.
 */
export function extractCommentThreadIds(doc: JSONContent): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  function walk(node: JSONContent): void {
    for (const mark of node.marks ?? []) {
      const id = mark.type === "comment" ? (mark.attrs?.threadId as string | undefined) : undefined;
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    for (const child of node.content ?? []) walk(child);
  }

  walk(doc);
  return ids;
}
