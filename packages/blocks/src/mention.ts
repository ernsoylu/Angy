import { Node, mergeAttributes } from "@tiptap/core";

/**
 * An @-mention of a workspace user.
 *
 * Inline and atomic: it sits in a paragraph like a word, but its text is not
 * editable in place — the label belongs to the user, not to the sentence, so
 * letting someone retype it would let one document disagree with the directory
 * about who was mentioned.
 *
 * `userId` is the identity; `label` is a *cache* of the display name, held for
 * the same reason `pageLink` caches a title — the static renderer is a pure
 * JSON→HTML function and must never look a name up in the database on the read
 * path. And it goes stale the same way, so it is repaired the same way:
 * resolved on the projection for readers, rewritten in the Y.Doc for editors.
 */
export const Mention = Node.create({
  name: "mention",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      userId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-user-id"),
        renderHTML: (attributes) => ({ "data-user-id": attributes.userId as string }),
      },
      label: {
        default: "someone",
        // The rendered text carries the "@"; the attribute never does, so that
        // re-parsing HTML cannot accumulate "@@name".
        parseHTML: (element) => element.textContent?.replace(/^@/, "").trim() || "someone",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-mention]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const label = (node.attrs.label as string) || "someone";
    return [
      "span",
      mergeAttributes(HTMLAttributes, { "data-mention": "", class: "mention" }),
      `@${label}`,
    ] as never;
  },
});
