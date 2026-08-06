import { Redis } from "ioredis";
import * as Y from "yjs";
import { getPrisma } from "@angy/db";
import { env } from "./env.js";
import { getObject, putObject } from "./s3.js";

const hotKey = (pageId: string) => `ydoc:hot:${pageId}`;
export const revisionKey = (pageId: string, version: number) =>
  `revisions/${pageId}/v${version}`;

let hotRedis: Redis | undefined;

function redis(): Redis {
  hotRedis ??= new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
  return hotRedis;
}

/** Current authoritative doc bytes: Redis hot cache while edited, else S3. */
export async function currentDocBytes(pageId: string): Promise<Uint8Array | null> {
  const hot = await redis().getBuffer(hotKey(pageId));
  if (hot) return new Uint8Array(hot);
  const page = await getPrisma().page.findUnique({ where: { id: pageId } });
  if (!page?.ydocS3Key) return null;
  return getObject(page.ydocS3Key);
}

/**
 * Write a revision checkpoint (ADR 0006): a full encodeStateAsUpdate blob to
 * S3 plus a page_revision row. Skips silently when the doc is unchanged since
 * the latest revision (identical state vectors) — unless the checkpoint is
 * labelled (compaction/restore markers always record).
 */
export async function writeRevisionCheckpoint(
  pageId: string,
  createdBy: bigint,
  label: string | null = null,
): Promise<number | null> {
  const prisma = getPrisma();
  const bytes = await currentDocBytes(pageId);
  if (!bytes) return null;

  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  const stateVector = Buffer.from(Y.encodeStateVector(doc));
  doc.destroy();

  const latest = await prisma.pageRevision.findFirst({
    where: { pageId },
    orderBy: { version: "desc" },
  });
  if (
    label === null &&
    latest?.stateVector &&
    Buffer.from(latest.stateVector).equals(stateVector)
  ) {
    return null;
  }

  const version = (latest?.version ?? 0) + 1;
  const key = revisionKey(pageId, version);
  await putObject(key, bytes);
  await prisma.pageRevision.create({
    data: {
      pageId,
      version,
      revisionS3Key: key,
      stateVector,
      label,
      sizeBytes: BigInt(bytes.byteLength),
      createdBy,
    },
  });
  console.log(`[worker] revision v${version} for ${pageId}${label ? ` (${label})` : ""}`);
  return version;
}

/**
 * Compaction (docs/runbooks/compaction.md): round-trip the doc through Yjs to
 * merge update history, write the new blob under a NEW key, verify it, swap
 * the pointer, and record a labelled revision. The old blob stays until the
 * next cycle. encodeStateAsUpdate is memory-hungry (~75× doc size) — this runs
 * only here, with bounded concurrency.
 */
export async function compactPage(pageId: string): Promise<void> {
  const prisma = getPrisma();
  const page = await prisma.page.findUnique({ where: { id: pageId } });
  if (!page?.ydocS3Key || page.deletedAt) return;
  const bytes = await currentDocBytes(pageId);
  if (!bytes) return;

  const doc = new Y.Doc();
  Y.applyUpdate(doc, bytes);
  const compacted = Y.encodeStateAsUpdate(doc);
  const stateVector = Buffer.from(Y.encodeStateVector(doc));
  doc.destroy();

  const newKey = `ydoc/${pageId}/c${Date.now()}`;
  await putObject(newKey, compacted);
  const verify = await getObject(newKey);
  if (!verify || verify.byteLength !== compacted.byteLength) {
    throw new Error(`Compaction verify failed for ${pageId}`);
  }
  await prisma.page.update({
    where: { id: pageId },
    data: { ydocS3Key: newKey, ydocStateVector: stateVector },
  });
  await redis().set(hotKey(pageId), Buffer.from(compacted), "EX", 30 * 60, "XX");
  await writeRevisionCheckpoint(pageId, page.updatedBy ?? page.createdBy, "compaction");
  console.log(
    `[worker] compacted ${pageId}: ${bytes.byteLength} -> ${compacted.byteLength} bytes`,
  );
}

/**
 * Pages whose doc changed since their last compaction. Compares state vectors,
 * not timestamps — compaction itself touches the page row, so a timestamp
 * comparison would re-enqueue every page forever.
 */
export async function findCompactionCandidates(): Promise<string[]> {
  const prisma = getPrisma();
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM page p
    WHERE p.deleted_at IS NULL AND p.ydoc_s3_key IS NOT NULL
      AND p.ydoc_state_vector IS DISTINCT FROM (
        SELECT r.state_vector FROM page_revision r
        WHERE r.page_id = p.id AND r.label = 'compaction'
        ORDER BY r.created_at DESC LIMIT 1
      )
  `;
  return rows.map((r) => r.id);
}
