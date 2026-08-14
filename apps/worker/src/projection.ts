import type { JSONContent } from "@tiptap/core";
import * as Y from "yjs";
import {
  createYdocFromJson,
  extractRefs,
  extractText,
  renderDocumentToHtml,
  resolveRefLabels,
  ydocToJson,
  type DocRef,
  type RefKind,
  type RefLabels,
} from "@angy/blocks";
import {
  findStaleReferrers,
  getPrisma,
  raiseMentionNotifications,
  replaceBlockIndex,
  type BlockRefInput,
  type BlockRefKind,
  type Prisma,
  type PrismaClient,
} from "@angy/db";
import { getObject, putObject } from "./s3.js";

export const ydocKey = (pageId: string) => `ydoc/${pageId}`;

/**
 * The block schema's ref kinds, mapped onto the database enum. Exhaustive by
 * construction: a new `RefKind` that nobody maps here is a type error, not a
 * node type that silently stops being indexed.
 */
const REF_KIND: Record<RefKind, BlockRefKind> = {
  page_link: "PAGE_LINK",
  mention: "MENTION",
  task: "TASK",
};

/** Work a rebuild created for *other* pages: they name this one by its old title. */
export interface ReferrerRefresh {
  /** The page just projected — the link target whose title moved on. */
  targetPageId: string;
  /** The title referrers should be showing. */
  title: string;
  /** Live pages currently rendering something else. */
  pageIds: string[];
}

const toBlockRef = (ref: DocRef): BlockRefInput => ({
  ord: ref.ord,
  kind: REF_KIND[ref.kind],
  targetPageId: ref.targetPageId,
  targetUserId: ref.targetUserId,
  payload: ref.payload,
});

/**
 * Current names for whatever a document references — page titles for links,
 * display names for mentions.
 *
 * Trashed pages are left out so their links keep the label they were authored
 * with rather than the name of something nobody can open. Deactivated users
 * are *not*: a mention is a record of who was named, and someone who has left
 * should still be readable as themselves rather than as "someone".
 */
async function refLabels(prisma: PrismaClient, refs: readonly DocRef[]): Promise<RefLabels> {
  const pageIds = [...new Set(refs.flatMap((r) => (r.targetPageId ? [r.targetPageId] : [])))];
  const userIds = [...new Set(refs.flatMap((r) => (r.targetUserId ? [r.targetUserId] : [])))];

  const [pages, users] = await Promise.all([
    pageIds.length === 0
      ? []
      : prisma.page.findMany({
          where: { id: { in: pageIds }, deletedAt: null },
          select: { id: true, title: true },
        }),
    userIds.length === 0
      ? []
      : prisma.appUser.findMany({
          where: { id: { in: userIds.map((id) => BigInt(id)) } },
          select: { id: true, displayName: true },
        }),
  ]);

  return {
    pages: new Map(pages.map((page) => [page.id, page.title])),
    users: new Map(users.map((user) => [user.id.toString(), user.displayName])),
  };
}

/**
 * Initialise the Y.Doc for a freshly created page: build it from the page's
 * document_json (or the empty document), persist the update bytes to S3, and
 * record ydoc_s3_key + state vector. Idempotent — skips if a doc exists.
 */
export async function initYdoc(pageId: string): Promise<ReferrerRefresh | null> {
  const prisma = getPrisma();
  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page) return null;
  if (page.ydocS3Key && (await getObject(page.ydocS3Key))) {
    return rebuildProjection(pageId);
  }

  const ydoc = createYdocFromJson(page.documentJson as JSONContent | null);
  const update = Y.encodeStateAsUpdate(ydoc);
  const key = ydocKey(pageId);
  await putObject(key, update);
  await prisma.page.update({
    where: { id: pageId },
    data: { ydocS3Key: key, ydocStateVector: Buffer.from(Y.encodeStateVector(ydoc)) },
  });
  return rebuildProjection(pageId);
}

/**
 * Rebuild read projections (document_json, rendered_html, text_extract,
 * block_index) for a page. The Y.Doc in S3 is authoritative when present;
 * document_json is the bootstrap fallback for pages that predate their Y.Doc.
 * Idempotent.
 *
 * `block_index` is written here and nowhere else, so it inherits this job's
 * rebuild trigger, reconciliation sweep and idempotency instead of becoming a
 * second write path with its own staleness modes.
 *
 * Returns the pages whose own projections are now out of date because this one
 * rebuilt — referrers rendering a link label this page no longer answers to.
 * They are returned rather than enqueued because the queue belongs to main.ts,
 * which is also where the reconcile sweep's results are enqueued.
 */
export async function rebuildProjection(pageId: string): Promise<ReferrerRefresh | null> {
  const prisma = getPrisma();
  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page || page.deletedAt) {
    // Trashed or gone — search must not keep serving it, and its attachments
    // lose the space_id the read filter scopes them by. Its outgoing links stop
    // counting as backlinks for the same reason: the page renders nowhere.
    // (A hard delete already took the rows with it, through the FK cascade.)
    await prisma.blockIndex.deleteMany({ where: { pageId } });
    const { indexAttachmentsForPage, removeFromIndex } = await import("./search.js");
    await removeFromIndex(pageId);
    await indexAttachmentsForPage(pageId);
    return null;
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
  if (!doc) return null;

  // Cached labels (link titles, mention names) are resolved for the read-path
  // artifacts only. The Y.Doc keeps what the editor authored — resolving into
  // it would give page.title a second writer alongside onStoreDocument — so
  // document_json stays a faithful projection of the document while
  // rendered_html and text_extract show each target's current name.
  const resolved = resolveRefLabels(doc, await refLabels(prisma, extractRefs(doc)));

  await prisma.page.update({
    where: { id: pageId },
    data: {
      documentJson: doc as Prisma.InputJsonValue,
      renderedHtml: renderDocumentToHtml(resolved),
      textExtract: extractText(resolved),
      projectionUpdatedAt: new Date(),
    },
  });
  // Indexed from the resolved document, so the recorded label is the one the
  // reader was served — which is what findStaleReferrers compares against.
  const refs = extractRefs(resolved);
  await replaceBlockIndex(prisma, pageId, refs.map(toBlockRef));
  // Inbox rows for whoever this page names (V2 H3). Idempotent, because a
  // rebuild re-runs on every store, every relabel and every reconcile pass.
  const raised = await raiseMentionNotifications(
    prisma,
    pageId,
    refs.flatMap((ref) =>
      ref.kind === "mention" && ref.targetUserId ? [BigInt(ref.targetUserId)] : [],
    ),
    page.updatedBy ?? page.createdBy,
  );
  if (raised > 0) console.log(`[worker] raised ${raised} mention notification(s) on ${pageId}`);
  // Keep search in lockstep with projections (ADR 0009). Attachments ride
  // along: a move changes their space, a restore brings them back.
  const { indexAttachmentsForPage, indexPage } = await import("./search.js");
  await indexPage(pageId);
  await indexAttachmentsForPage(pageId);

  return {
    targetPageId: pageId,
    title: page.title,
    pageIds: await findStaleReferrers(prisma, pageId, page.title),
  };
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
