import { describe, expect, it } from "vitest";
import {
  attachmentSchema,
  createPageSchema,
  movePageSchema,
  pageDetailSchema,
  pageListItemSchema,
  pagePermissionsSchema,
  pageSummarySchema,
  revisionSchema,
  spaceHomeSchema,
  spaceSchema,
  trashItemSchema,
  upsertGrantSchema,
  userSchema,
} from "./dto.js";
import { QUEUE_MAINTENANCE, QUEUE_PROJECTIONS } from "./queues.js";

const UUID = "3e0e5cbb-98cb-4a4a-b16c-4a7de7cf9b6b";
const NOW = new Date().toISOString();

describe("dto schemas", () => {
  it("accept canonical payloads", () => {
    expect(() =>
      spaceSchema.parse({
        id: "1",
        key: "eng",
        name: "Engineering",
        description: null,
        visibility: "PUBLIC",
        defaultPermLevel: "VIEW",
      }),
    ).not.toThrow();
    expect(() => userSchema.parse({ id: "5", email: "e@x.io", displayName: "E" })).not.toThrow();
    expect(() =>
      pageSummarySchema.parse({ id: UUID, title: "T", slug: "t", parentId: null }),
    ).not.toThrow();
    expect(() =>
      pageDetailSchema.parse({
        id: UUID,
        spaceId: "1",
        parentId: null,
        title: "T",
        slug: "t",
        renderedHtml: "<p>x</p>",
        breadcrumb: [{ id: UUID, title: "T", slug: "t" }],
        version: 3,
        updatedByName: "Mira",
        contributors: 2,
        starred: false,
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ).not.toThrow();
    expect(() =>
      pageListItemSchema.parse({
        id: UUID,
        title: "Runbooks",
        parentTitle: null,
        at: NOW,
        updatedByName: "Mira",
      }),
    ).not.toThrow();
    expect(() =>
      revisionSchema.parse({
        version: 1,
        label: null,
        authorName: "Mira",
        current: true,
        sizeBytes: 100,
        createdAt: NOW,
      }),
    ).not.toThrow();
    expect(() =>
      trashItemSchema.parse({
        id: UUID,
        title: "T",
        parentTitle: null,
        spaceName: "Engineering",
        trashedByName: "Eren",
        deletedAt: NOW,
        hardDeleteAt: NOW,
      }),
    ).not.toThrow();
    expect(() =>
      attachmentSchema.parse({
        id: "1",
        fileName: "a.png",
        mimeType: "image/png",
        sizeBytes: 10,
        width: null,
        height: null,
        sha256: "ab",
        pageId: UUID,
        pageTitle: null,
        usedOnPages: [{ id: UUID, title: "Realtime Sync" }],
        uploadedByName: null,
        createdAt: NOW,
        url: "http://x/y",
        thumbnailUrl: null,
        signed: false,
        docSrc: "/media/media-private/ab",
      }),
    ).not.toThrow();
    expect(() =>
      pagePermissionsSchema.parse({
        space: { name: "Eng", memberCount: 5, baseline: "VIEW", visibility: "PUBLIC" },
        owner: { id: "1", displayName: "Mira", email: "m@x.io" },
        grants: [{ userId: "4", displayName: "Ada", email: "a@x.io", level: "EDIT" }],
        descendants: 3,
      }),
    ).not.toThrow();
    expect(() =>
      spaceHomeSchema.parse({
        space: {
          id: "1",
          key: "eng",
          name: "Engineering",
          description: null,
          visibility: "PUBLIC",
          defaultPermLevel: "VIEW",
        },
        stats: { pages: 1, contributors: 1, updatedToday: 0, attachmentBytes: 0 },
        recentlyUpdated: [],
        members: [],
      }),
    ).not.toThrow();
  });

  it("reject malformed payloads", () => {
    expect(createPageSchema.safeParse({ spaceId: "abc", title: "x" }).success).toBe(false);
    expect(createPageSchema.safeParse({ spaceId: "1", title: "" }).success).toBe(false);
    expect(movePageSchema.safeParse({ parentId: "not-a-uuid" }).success).toBe(false);
    expect(movePageSchema.safeParse({ parentId: null }).success).toBe(true);
    expect(upsertGrantSchema.safeParse({ email: "nope", level: "EDIT" }).success).toBe(false);
    expect(upsertGrantSchema.safeParse({ email: "a@b.io", level: "ADMIN" }).success).toBe(false);
  });

  it("pins the queue contract shared with the worker", () => {
    expect(QUEUE_PROJECTIONS).toBe("projections");
    expect(QUEUE_MAINTENANCE).toBe("maintenance");
  });
});
