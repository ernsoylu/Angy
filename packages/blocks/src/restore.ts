import { getSchema, type JSONContent } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { updateYFragment } from "y-prosemirror";
import type * as Y from "yjs";
import { baseExtensions } from "./extensions.js";
import { YDOC_FIELD } from "./ydoc.js";

/**
 * Apply ProseMirror JSON to a live Y.Doc as a normal forward update —
 * the non-destructive restore path (ADR 0006). updateYFragment computes a
 * minimal in-place change set, so connected clients converge on it like any
 * other edit and history is never rewritten.
 */
export function applyDocJson(ydoc: Y.Doc, json: JSONContent): void {
  const schema = getSchema(baseExtensions());
  const node = PMNode.fromJSON(schema, json);
  updateYFragment(ydoc, ydoc.getXmlFragment(YDOC_FIELD), node, {
    mapping: new Map(),
    isOMark: new Map(),
  });
}
