import { Node, mergeAttributes } from "@tiptap/core";

export const CALLOUT_TONES = ["note", "added", "hardRule", "removed"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

/**
 * Callout block (frame C: 4 tones · 3px left rule · 10px radius). The tone and
 * optional title are attributes; the body is regular block content.
 */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      tone: {
        default: "note",
        parseHTML: (element) => element.getAttribute("data-tone") ?? "note",
        renderHTML: (attributes) => ({ "data-tone": attributes.tone as string }),
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-title"),
        renderHTML: (attributes) =>
          attributes.title ? { "data-title": attributes.title as string } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "aside[data-callout]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = node.attrs.title as string | null;
    const body: unknown[] = ["div", { class: "callout-body" }, 0];
    return [
      "aside",
      mergeAttributes(HTMLAttributes, {
        "data-callout": "",
        class: `callout callout-${node.attrs.tone as string}`,
      }),
      ...(title ? [["div", { class: "callout-title" }, title]] : []),
      body,
    ] as never;
  },
});
