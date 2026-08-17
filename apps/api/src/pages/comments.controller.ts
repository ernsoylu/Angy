import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  commentAudience,
  getEffectivePageLevel,
  getPrisma,
  raiseCommentNotifications,
} from "@angy/db";
import {
  commentBodySchema,
  createThreadSchema,
  ok,
  resolveThreadSchema,
  satisfies,
  type ApiOk,
  type CommentBodyDto,
  type CommentThreadDto,
  type CreateThreadDto,
  type ResolveThreadDto,
} from "@angy/shared";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";
import { PagePermissionGuard, RequirePageLevel } from "../permissions/page-permission.guard";
import { ZodValidationPipe } from "../zod.pipe";

type ThreadRow = Awaited<ReturnType<typeof loadThreads>>[number];

const WITH_COMMENTS = {
  comments: {
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, displayName: true } } },
  },
} as const;

async function loadThreads(pageId: string) {
  return getPrisma().commentThread.findMany({
    where: { pageId },
    orderBy: { createdAt: "asc" },
    include: WITH_COMMENTS,
  });
}

/** Display names for whoever resolved these threads, in one query. */
async function resolverNames(threads: readonly { resolvedBy: bigint | null }[]) {
  const ids = [...new Set(threads.flatMap((t) => (t.resolvedBy ? [t.resolvedBy] : [])))];
  if (ids.length === 0) return new Map<string, string>();
  const users = await getPrisma().appUser.findMany({
    where: { id: { in: ids } },
    select: { id: true, displayName: true },
  });
  return new Map(users.map((user) => [user.id.toString(), user.displayName]));
}

function toDto(thread: ThreadRow, resolverNames: Map<string, string>): CommentThreadDto {
  return {
    id: thread.id,
    pageId: thread.pageId,
    anchorText: thread.anchorText,
    createdAt: thread.createdAt.toISOString(),
    resolved: thread.resolvedAt !== null,
    resolvedByName: thread.resolvedBy
      ? (resolverNames.get(thread.resolvedBy.toString()) ?? null)
      : null,
    orphaned: thread.orphanedAt !== null,
    comments: thread.comments.map((comment) => ({
      id: comment.id.toString(),
      authorId: comment.authorId.toString(),
      authorName: comment.author.displayName,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      editedAt: comment.editedAt?.toISOString() ?? null,
    })),
  };
}

/**
 * Comments (V2 H5.2, ADR 0014).
 *
 * Every write here is relational and **none of them touch the Y.Doc**: only
 * opening a thread writes to the document, and the editor does that itself by
 * applying the mark once this endpoint has handed it a thread id. Replying,
 * resolving and deleting therefore produce no Yjs update, no revision
 * checkpoint and no projection rebuild — a page's history should record edits,
 * not conversations.
 *
 * Permissions are the page's, with no comment-level ACL: VIEW to read a
 * thread, EDIT to write one.
 */
@Controller()
@UseGuards(SessionGuard, PagePermissionGuard)
export class CommentsController {
  @Get("pages/:id/comments")
  @RequirePageLevel("VIEW")
  async list(@Param("id") id: string): Promise<ApiOk<CommentThreadDto[]>> {
    const threads = await loadThreads(id);
    const names = await resolverNames(threads);
    return ok(threads.map((thread) => toDto(thread, names)));
  }

  /**
   * Open a thread. The id comes back before any mark exists, because the
   * editor needs it to write one — a thread whose mark never landed is flagged
   * `orphaned` by the next projection rather than lingering as a mystery.
   */
  @Post("pages/:id/comments")
  @RequirePageLevel("EDIT")
  async create(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createThreadSchema)) body: CreateThreadDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<CommentThreadDto>> {
    const prisma = getPrisma();
    const page = await prisma.page.findFirst({ where: { id, deletedAt: null } });
    if (!page) throw new NotFoundException("Page not found");

    const thread = await prisma.commentThread.create({
      data: {
        pageId: id,
        anchorText: body.anchorText,
        createdBy: req.user.id,
        comments: { create: { authorId: req.user.id, body: body.body } },
      },
    });
    await this.notify(id, thread.id, req.user.id);
    return ok(await this.one(thread.id));
  }

  @Post("comments/:threadId/replies")
  async reply(
    @Param("threadId") threadId: string,
    @Body(new ZodValidationPipe(commentBodySchema)) body: CommentBodyDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<CommentThreadDto>> {
    const thread = await this.assertLevel(threadId, req.user.id, "EDIT");
    await getPrisma().comment.create({
      data: { threadId, authorId: req.user.id, body: body.body },
    });
    await this.notify(thread.pageId, threadId, req.user.id);
    return ok(await this.one(threadId));
  }

  /** Resolve or reopen. A thread state, never a document write (ADR 0014). */
  @Post("comments/:threadId/resolve")
  async resolve(
    @Param("threadId") threadId: string,
    @Body(new ZodValidationPipe(resolveThreadSchema)) body: ResolveThreadDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<CommentThreadDto>> {
    await this.assertLevel(threadId, req.user.id, "EDIT");
    await getPrisma().commentThread.update({
      where: { id: threadId },
      data: body.resolved
        ? { resolvedAt: new Date(), resolvedBy: req.user.id }
        : { resolvedAt: null, resolvedBy: null },
    });
    return ok(await this.one(threadId));
  }

  @Patch("comments/:threadId/:commentId")
  async edit(
    @Param("threadId") threadId: string,
    @Param("commentId") commentId: string,
    @Body(new ZodValidationPipe(commentBodySchema)) body: CommentBodyDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<CommentThreadDto>> {
    await this.assertLevel(threadId, req.user.id, "VIEW");
    const prisma = getPrisma();
    // Authorship, not page level: editing someone else's words is not
    // something any amount of access on the page should grant.
    const changed = await prisma.comment.updateMany({
      where: { id: BigInt(commentId), threadId, authorId: req.user.id, deletedAt: null },
      data: { body: body.body, editedAt: new Date() },
    });
    if (changed.count === 0) throw new ForbiddenException("You can only edit your own comments");
    return ok(await this.one(threadId));
  }

  /**
   * Delete one remark. Soft, so a reply that quotes it still reads, and
   * allowed to its author or to anyone with FULL on the page — the same tier
   * that can delete the page it sits on.
   */
  @Delete("comments/:threadId/:commentId")
  async removeComment(
    @Param("threadId") threadId: string,
    @Param("commentId") commentId: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<CommentThreadDto | null>> {
    const thread = await this.assertLevel(threadId, req.user.id, "VIEW");
    const prisma = getPrisma();
    const level = await getEffectivePageLevel(prisma, req.user.id, thread.pageId);
    const changed = await prisma.comment.updateMany({
      where: {
        id: BigInt(commentId),
        threadId,
        deletedAt: null,
        ...(satisfies(level, "FULL") ? {} : { authorId: req.user.id }),
      },
      data: { deletedAt: new Date() },
    });
    if (changed.count === 0) throw new ForbiddenException("You can only delete your own comments");

    // A thread with nothing left in it is not a thread. Its mark stays in the
    // document and simply stops painting — no document write, by design.
    const left = await prisma.comment.count({ where: { threadId, deletedAt: null } });
    if (left === 0) {
      await prisma.commentThread.delete({ where: { id: threadId } });
      return ok(null);
    }
    return ok(await this.one(threadId));
  }

  /** Delete a whole thread — its author, or FULL on the page. */
  @Delete("comments/:threadId")
  async removeThread(
    @Param("threadId") threadId: string,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ deleted: true }>> {
    const thread = await this.assertLevel(threadId, req.user.id, "VIEW");
    const prisma = getPrisma();
    const level = await getEffectivePageLevel(prisma, req.user.id, thread.pageId);
    if (thread.createdBy !== req.user.id && !satisfies(level, "FULL")) {
      throw new ForbiddenException("You can only delete your own threads");
    }
    await prisma.commentThread.delete({ where: { id: threadId } });
    return ok({ deleted: true as const });
  }

  /**
   * The thread routes are keyed by thread, so the guard — which reads `:id` as
   * a page — cannot help. Resolve the page here and check it explicitly.
   */
  private async assertLevel(threadId: string, userId: bigint, level: "VIEW" | "EDIT") {
    const thread = await getPrisma().commentThread.findFirst({
      where: { id: threadId, page: { deletedAt: null } },
    });
    if (!thread) throw new NotFoundException("Comment thread not found");
    const effective = await getEffectivePageLevel(getPrisma(), userId, thread.pageId);
    if (!satisfies(effective, level)) {
      throw new ForbiddenException("You don't have access to this page");
    }
    return thread;
  }

  private async one(threadId: string): Promise<CommentThreadDto> {
    const thread = await getPrisma().commentThread.findUnique({
      where: { id: threadId },
      include: WITH_COMMENTS,
    });
    if (!thread) throw new NotFoundException("Comment thread not found");
    return toDto(thread, await resolverNames([thread]));
  }

  private async notify(pageId: string, threadId: string, actorId: bigint): Promise<void> {
    const prisma = getPrisma();
    const audience = await commentAudience(prisma, threadId, actorId);
    await raiseCommentNotifications(prisma, pageId, audience, actorId);
  }
}
