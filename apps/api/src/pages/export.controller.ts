import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { documentToMarkdown, type JSONContent } from "@angy/blocks";
import { filterReadablePages, getPrisma, getSubtree } from "@angy/db";
import { env } from "../env";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";
import {
  PagePermissionGuard,
  RequirePageLevel,
} from "../permissions/page-permission.guard";

/**
 * Markdown export (ADR 0005, the one-directional *out* flow).
 *
 * Serves `document_json` — the projection — rather than decoding the Y.Doc
 * here. The API is CommonJS and must never construct a Y.Doc (CLAUDE.md
 * gotcha: mixing the CJS and ESM yjs builds creates two instances), and the
 * projection is exactly what the reader is being served anyway, so an export
 * and a read can never disagree.
 *
 * There is no import counterpart that merges back into an existing page, and
 * there never will be: Markdown cannot carry CRDT tombstones, so a round trip
 * would silently discard the history concurrent editing depends on.
 */
@Controller()
@UseGuards(SessionGuard, PagePermissionGuard)
export class ExportController {
  /** One page as Markdown. */
  @Get("pages/:id/export.md")
  @RequirePageLevel("VIEW")
  async page(@Param("id") id: string, @Res() res: Response): Promise<void> {
    const page = await getPrisma().page.findFirst({ where: { id, deletedAt: null } });
    if (!page) throw new NotFoundException("Page not found");

    send(res, `${slugForFile(page.slug)}.md`, render(page));
  }

  /**
   * A page and everything under it, as one Markdown document.
   *
   * Filtered by the caller's read access per page rather than gated on the
   * root alone: page grants only widen, so a subtree can legitimately contain
   * a page this user may not read, and exporting it would hand over content no
   * screen would have shown them.
   */
  @Get("pages/:id/export-subtree.md")
  @RequirePageLevel("VIEW")
  async subtree(
    @Param("id") id: string,
    @Query("depth") depth: string | undefined,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const prisma = getPrisma();
    const root = await prisma.page.findFirst({ where: { id, deletedAt: null } });
    if (!root) throw new NotFoundException("Page not found");

    const subtree = await getSubtree(prisma, id);
    const maxDepth = depth === undefined ? Infinity : Number(depth);
    if (Number.isNaN(maxDepth) || maxDepth < 0) {
      throw new ForbiddenException("depth must be a non-negative number");
    }

    const wanted = subtree.filter((row) => Number(row.depth ?? 0) <= maxDepth);
    const readable = await filterReadablePages(
      prisma,
      req.user.id,
      wanted.map((row) => row.id),
    );
    const pages = await prisma.page.findMany({
      where: { id: { in: wanted.filter((row) => readable.has(row.id)).map((row) => row.id) } },
    });
    // Subtree order, not database order — an export should read like the tree.
    const byId = new Map(pages.map((page) => [page.id, page]));
    const ordered = wanted.flatMap((row) => {
      const page = byId.get(row.id);
      return page ? [page] : [];
    });

    const skipped = wanted.length - ordered.length;
    const body = ordered.map((page) => render(page)).join("\n---\n\n");
    // Say what was withheld rather than returning a quietly shorter document.
    const note =
      skipped > 0
        ? `\n---\n\n_${skipped} page(s) in this subtree were omitted: you do not have access to them._\n`
        : "";

    send(res, `${slugForFile(root.slug)}-subtree.md`, body + note);
  }
}

function render(page: { title: string; documentJson: unknown }): string {
  const doc = page.documentJson as JSONContent | null;
  if (!doc) return `# ${page.title}\n\n_This page has no content yet._\n`;
  return documentToMarkdown(doc, page.title, {
    // Absolute, because an exported file is read outside the app where a
    // root-relative permalink resolves against whatever host opened it.
    pageLinkBase: `${env.publicApiUrl().replace(/\/api\/?$/, "")}/p`,
  });
}

/** Content-Disposition is header-encoded, so the filename must not carry quotes or newlines. */
const slugForFile = (slug: string) => slug.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "page";

function send(res: Response, filename: string, body: string): void {
  res.setHeader("content-type", "text/markdown; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="${filename}"`);
  res.send(body);
}
