import type { JSONContent } from "@tiptap/core";
import * as Y from "yjs";
import {
  createYdocFromJson,
  extractText,
  renderDocumentToHtml,
  ydocToJson,
} from "@angy/blocks";
import { getPrisma, type Prisma } from "@angy/db";
import { getObject, putObject } from "./s3.js";

export const ydocKey = (pageId: string) => `ydoc/${pageId}`;

/**
 * Initialise the Y.Doc for a freshly created page: build it from the page's
 * document_json (or the empty document), persist the update bytes to S3, and
 * record ydoc_s3_key + state vector. Idempotent — skips if a doc exists.
 */
export async function initYdoc(pageId: string): Promise<void> {
  const prisma = getPrisma();
  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page) return;
  if (page.ydocS3Key && (await getObject(page.ydocS3Key))) {
    await rebuildProjection(pageId);
    return;
  }

  const ydoc = createYdocFromJson(page.documentJson as JSONContent | null);
  const update = Y.encodeStateAsUpdate(ydoc);
  const key = ydocKey(pageId);
  await putObject(key, update);
  await prisma.page.update({
    where: { id: pageId },
    data: { ydocS3Key: key, ydocStateVector: Buffer.from(Y.encodeStateVector(ydoc)) },
  });
  await rebuildProjection(pageId);
}

/**
 * Rebuild read projections (document_json, rendered_html, text_extract) for a
 * page. The Y.Doc in S3 is authoritative when present; document_json is the
 * bootstrap fallback for pages that predate their Y.Doc. Idempotent.
 */
export async function rebuildProjection(pageId: string): Promise<void> {
  const prisma = getPrisma();
  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page || page.deletedAt) {
    // Trashed or gone — search must not keep serving it.
    const { removeFromIndex } = await import("./search.js");
    await removeFromIndex(pageId);
    return;
  }

  let doc: JSONContent | null = null;
  if (page.ydocS3Key) {
    const bytes = await getObject(page.ydocS3Key);
    if (bytes) {
      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, bytes);
      doc = ydocToJson(ydoc);
      ydoc.destroy();
    }
  }
  doc ??= page.documentJson as JSONContent | null;
  if (!doc) return;

  await prisma.page.update({
    where: { id: pageId },
    data: {
      documentJson: doc as Prisma.InputJsonValue,
      renderedHtml: renderDocumentToHtml(doc),
      textExtract: extractText(doc),
      projectionUpdatedAt: new Date(),
    },
  });
  // Keep search in lockstep with projections (ADR 0009).
  const { indexPage } = await import("./search.js");
  await indexPage(pageId);
}

/**
 * Reconciliation sweep: projections can silently go stale if a worker dies
 * after the S3 write. Requeue every live page whose projection is missing or
 * older than the page row. Rebuilds are idempotent, so over-enqueueing is safe.
 */
export async function findStalePageIds(): Promise<string[]> {
  const prisma = getPrisma();
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM page
    WHERE deleted_at IS NULL
      AND (projection_updated_at IS NULL OR projection_updated_at < updated_at)
  `;
  return rows.map((r) => r.id);
}
