import type { Extensions } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Callout } from "./callout.js";
import { Mention } from "./mention.js";
import { PageLink } from "./page-link.js";

/**
 * The one place the V1 block schema is defined (isomorphic-block invariant):
 * consumed by apps/web (editor) and apps/worker (static renderer). Never
 * reimplement a block's rendering elsewhere.
 */
function makeExtensions(options: { undoRedo: boolean }): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // Tiptap 3: Collaboration ships its own history — undoRedo must be off
      // in the collaborative editor (CLAUDE.md gotcha).
      ...(options.undoRedo ? {} : { undoRedo: false }),
    }),
    Image.configure({ allowBase64: false }),
    Table,
    TableRow,
    TableHeader,
    TableCell,
    Callout,
    PageLink,
    Mention,
    TaskList,
    // Nested to-dos, so a checklist can have sub-items like every other list.
    // The checkbox is inert on the read path: rendered_html is a projection,
    // and letting a reader tick a box there would write nowhere.
    TaskItem.configure({ nested: true }),
  ];
}

/** Schema-defining set for the static renderer and Y.Doc conversion. */
export function baseExtensions(): Extensions {
  return makeExtensions({ undoRedo: true });
}

/** Editor set for the collaborative client — undoRedo comes from Collaboration. */
export function editorExtensions(): Extensions {
  return makeExtensions({ undoRedo: false });
}
