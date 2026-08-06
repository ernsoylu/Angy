import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { PermLevel } from "@prisma/client";
import { JOB_PROJECTION_REBUILD, QUEUE_PROJECTIONS } from "@angy/shared";
import { getPrisma } from "./client.js";
import { createPage } from "./closure.js";

const prisma = getPrisma();

function html(paragraphs: string[]): string {
  return paragraphs.join("\n");
}

/** Minimal ProseMirror doc of plain paragraphs — the worker rebuilds real projections from it. */
function textDoc(...paragraphs: string[]) {
  return {
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
}

async function main() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE attachment, page_revision, page_permission, page_ancestor, page, space_member, app_user, space RESTART IDENTITY CASCADE`,
  );

  // TRUNCATE bypasses the pipeline — purge the search index too, or ghosts of
  // every previous seed keep matching queries. Rebuilds repopulate it below.
  await fetch(
    `${process.env.MEILISEARCH_URL ?? "http://localhost:7700"}/indexes/pages/documents`,
    {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${process.env.MEILISEARCH_API_KEY ?? "masterKey"}`,
      },
    },
  ).catch(() => console.warn("(meilisearch unreachable — search index not purged)"));

  // Sequential creation keeps ids deterministic (mira=1 … eren=5) across reseeds.
  const users = [];
  for (const [sub, displayName, email] of [
    ["mira", "Mira Kalvo", "mira@acme.io"],
    ["rana", "Rana Terzi", "rana@acme.io"],
    ["jonas", "Jonas Dahl", "jonas@acme.io"],
    ["ada", "Ada Lund", "ada@acme.io"],
    ["eren", "Eren Soylu", "eren@acme.io"],
  ]) {
    users.push(
      await prisma.appUser.create({
        data: { oidcSubject: `seed|${sub}`, displayName: displayName!, email: email! },
      }),
    );
  }
  const [mira, rana, jonas, ada, eren] = users;

  const engineering = await prisma.space.create({
    data: {
      key: "eng",
      name: "Engineering",
      description: "Architecture decisions, runbooks, and the system of record for how Angy is built.",
      members: {
        create: [
          { userId: mira!.id, permLevel: PermLevel.ADMIN },
          { userId: rana!.id, permLevel: PermLevel.EDIT },
          { userId: jonas!.id, permLevel: PermLevel.EDIT },
          { userId: ada!.id, permLevel: PermLevel.VIEW },
          { userId: eren!.id, permLevel: PermLevel.ADMIN },
        ],
      },
    },
  });

  const product = await prisma.space.create({
    data: {
      key: "product",
      name: "Product",
      visibility: "PRIVATE",
      members: { create: [{ userId: mira!.id, permLevel: PermLevel.ADMIN }] },
    },
  });

  await createPage(prisma, {
    spaceId: product.id,
    title: "Roadmap",
    slug: "roadmap",
    createdBy: mira!.id,
    documentJson: textDoc("Private space content — visible only to Product members."),
    renderedHtml: "<p>Private space content — visible only to Product members.</p>",
    textExtract: "Private space content — visible only to Product members.",
  });

  await createPage(prisma, {
    spaceId: engineering.id,
    title: "Onboarding",
    slug: "onboarding",
    createdBy: mira!.id,
    documentJson: textDoc("Start here: how we build, review, and ship Angy."),
    renderedHtml: html([
      "<p>Start here: how we build, review, and ship Angy.</p>",
    ]),
    textExtract: "Start here: how we build, review, and ship Angy.",
  });

  const architecture = await createPage(prisma, {
    spaceId: engineering.id,
    title: "Architecture",
    slug: "architecture",
    createdBy: mira!.id,
    documentJson: textDoc("System design notes for every subsystem."),
    renderedHtml: html(["<p>System design notes for every subsystem.</p>"]),
    textExtract: "System design notes for every subsystem.",
  });

  const realtimeSync = await createPage(prisma, {
    spaceId: engineering.id,
    parentId: architecture.id,
    title: "Realtime Sync Architecture",
    slug: "realtime-sync",
    createdBy: mira!.id,
    documentJson: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Every page in Angy is backed by exactly one Y.Doc. The document lives in Redis while it is being edited, is persisted to S3 on a debounce, and is never stored as a binary blob in Postgres.",
            },
          ],
        },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "The Y.Doc lifecycle" }] },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "When an editor clicks Edit, the client opens a WebSocket to Hocuspocus and hydrates from the live document. Readers never take this path — they are served pre-rendered HTML.",
            },
          ],
        },
        {
          type: "callout",
          attrs: { tone: "hardRule", title: "Hard rule 1" },
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Never store Yjs binary blobs in Postgres. Postgres holds only ydoc_s3_key and a small state vector.",
                },
              ],
            },
          ],
        },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Persistence contract" }] },
        {
          type: "codeBlock",
          content: [
            {
              type: "text",
              text: "onStoreDocument: async ({ document, documentName }) => {\n  const state = Y.encodeStateAsUpdate(document)\n  await s3.put(`ydoc/${documentName}`, state)\n  await queue.add('rebuild-projection', documentName)\n}",
            },
          ],
        },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Where state actually lives" }] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: ["Store", "Holds", "Authority"].map((text) => ({
                type: "tableHeader",
                content: [{ type: "paragraph", content: [{ type: "text", text }] }],
              })),
            },
            ...[
              ["S3", "Y.Doc + revision blobs", "Content"],
              ["Postgres", "Metadata, hierarchy, perms", "Structure"],
              ["Redis", "Hot doc, bitmaps, presence", "Never"],
            ].map((cells) => ({
              type: "tableRow",
              content: cells.map((text) => ({
                type: "tableCell",
                content: [{ type: "paragraph", content: [{ type: "text", text }] }],
              })),
            })),
          ],
        },
      ],
    },
    renderedHtml: html([
      "<p>Every page in Angy is backed by exactly one Y.Doc. The document lives in Redis while it is being edited, is persisted to S3 on a debounce, and is never stored as a binary blob in Postgres.</p>",
      "<h2>The Y.Doc lifecycle</h2>",
      "<p>When an editor clicks Edit, the client opens a WebSocket to Hocuspocus and hydrates from the live document. Readers never take this path — they are served pre-rendered HTML.</p>",
    ]),
    textExtract:
      "Every page in Angy is backed by exactly one Y.Doc. The document lives in Redis while it is being edited, is persisted to S3 on a debounce, and is never stored as a binary blob in Postgres. The Y.Doc lifecycle. When an editor clicks Edit, the client opens a WebSocket to Hocuspocus and hydrates from the live document.",
  });

  await Promise.all(
    [
      ["Storage Model", "storage-model", "Where every byte lives: Postgres, Redis, S3."],
      ["Permissions", "permissions", "Space baseline plus additive page grants."],
    ].map(([title, slug, text]) =>
      createPage(prisma, {
        spaceId: engineering.id,
        parentId: architecture.id,
        title: title!,
        slug: slug!,
        createdBy: rana!.id,
        documentJson: textDoc(text!),
        renderedHtml: `<p>${text}</p>`,
        textExtract: text,
      }),
    ),
  );

  await createPage(prisma, {
    spaceId: engineering.id,
    title: "Runbooks",
    slug: "runbooks",
    createdBy: jonas!.id,
    documentJson: textDoc("Operational procedures for the Angy stack."),
    renderedHtml: "<p>Operational procedures for the Angy stack.</p>",
    textExtract: "Operational procedures for the Angy stack.",
  });

  await createPage(prisma, {
    spaceId: engineering.id,
    title: "Decisions (ADR)",
    slug: "decisions",
    createdBy: mira!.id,
    documentJson: textDoc("Architecture decision records."),
    renderedHtml: "<p>Architecture decision records.</p>",
    textExtract: "Architecture decision records.",
  });

  // Revisions are not seeded: real checkpoints are written by the worker at
  // idle cutoff / explicit save / compaction (ADR 0006).
  await prisma.pagePermission.create({
    data: {
      pageId: realtimeSync.id,
      userId: ada!.id,
      permLevel: PermLevel.EDIT,
      grantedBy: mira!.id,
    },
  });

  const pageCount = await prisma.page.count();

  // Seeding bypasses the edit pipeline, so push every page through the
  // projection worker — otherwise search serves the PREVIOUS seed's documents
  // until the next reconcile sweep.
  const connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
  const projections = new Queue(QUEUE_PROJECTIONS, { connection });
  const pages = await prisma.page.findMany({ select: { id: true } });
  await projections.addBulk(
    pages.map((page) => ({ name: JOB_PROJECTION_REBUILD, data: { pageId: page.id } })),
  );
  await projections.close();
  connection.disconnect();

  console.log(
    `Seeded: ${pageCount} pages across 2 spaces (${engineering.name}, ${product.name}), 5 users; ${pages.length} projection rebuilds queued.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
