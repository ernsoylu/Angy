import { Node, mergeAttributes } from "@tiptap/core";

/**
 * A link to a child page, created inline from the editor (`/page`).
 *
 * An atom rather than a container: the child page owns its own Y.Doc, and
 * nesting one document's content inside another would break the one-Y.Doc-per-
 * page rule (hard rule 4). This node holds only a reference.
 *
 * The href is `/p/{pageId}`, not `/s/{spaceKey}/{pageId}`, deliberately. A page
 * can move between spaces, and a space key is baked into every link that names
 * it — the cross-space move would have to rewrite every referring document to
 * stay correct. Resolving through the page id costs one redirect and cannot go
 * stale.
 *
 * `title` is a *cached* label. The page's real title lives on its row and is
 * edited through its own Y.Doc, so renaming a page does not update links to it;
 * they keep the name they were created with until the referring page is edited.
 * Fixing that properly needs a backlink index to know which documents to
 * rebuild — that is `block_index`, and it is V2. Storing the title anyway is
 * what keeps the static renderer a pure JSON→HTML function, with no database
 * lookup on the read path.
 */
export const PageLink = Node.create({
  name: "pageLink",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-page-id"),
        renderHTML: (attributes) => ({ "data-page-id": attributes.pageId as string }),
      },
      title: {
        default: "Untitled",
        parseHTML: (element) => element.textContent?.trim() || "Untitled",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "a[data-page-link]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const title = (node.attrs.title as string) || "Untitled";
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        "data-page-link": "",
        class: "page-link",
        href: `/p/${node.attrs.pageId as string}`,
      }),
      title,
    ] as never;
  },
});
