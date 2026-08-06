import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { MeiliSearch } from "meilisearch";
import { generateTenantToken } from "meilisearch/token";
import { getPrisma } from "@angy/db";
import { ok, searchQuerySchema, type ApiOk, type SearchQueryDto } from "@angy/shared";
import { env } from "../env";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../zod.pipe";

const TOKEN_TTL_MS = 15 * 60 * 1000;
const SEARCH_INDEX = "pages";

/**
 * ADR 0009 guardrail: past this many explicit page grants, the filter is too
 * large to embed in a token — that user's searches are proxied through the
 * API instead.
 */
const GRANT_GUARDRAIL = 200;

let searchKey: { key: string; uid: string } | undefined;
let master: MeiliSearch | undefined;

function masterClient(): MeiliSearch {
  master ??= new MeiliSearch({ host: env.meilisearch.url, apiKey: env.meilisearch.apiKey });
  return master;
}

/**
 * The master key exists only here and in the worker; browsers and the web
 * server get short-lived tenant tokens minted from the default search key.
 */
async function getSearchKey(): Promise<{ key: string; uid: string }> {
  if (searchKey) return searchKey;
  const { results } = await masterClient().getKeys();
  const found = results.find(
    (key) => key.actions.includes("search") && key.actions.length === 1,
  );
  if (!found) throw new Error("Meilisearch default search key not found");
  searchKey = { key: found.key, uid: found.uid };
  return searchKey;
}

/** The user's exact read set as a Meilisearch filter (ADR 0009). */
async function buildReadFilter(
  userId: bigint,
): Promise<{ filter: string; grantCount: number }> {
  const prisma = getPrisma();
  const [spaces, grants] = await Promise.all([
    prisma.space.findMany({
      where: { OR: [{ visibility: "PUBLIC" }, { members: { some: { userId } } }] },
      select: { id: true },
    }),
    prisma.pagePermission.findMany({ where: { userId }, select: { pageId: true } }),
  ]);
  const spaceIds = spaces.map((s) => `"${s.id.toString()}"`).join(", ");
  const pageIds = grants.map((g) => `"${g.pageId}"`).join(", ");
  const clauses = [
    ...(spaceIds ? [`space_id IN [${spaceIds}]`] : []),
    ...(pageIds ? [`page_id IN [${pageIds}]`] : []),
  ];
  return {
    // A user with no readable spaces and no grants gets a filter matching nothing.
    filter: clauses.length > 0 ? clauses.join(" OR ") : 'space_id = "__none__"',
    grantCount: grants.length,
  };
}

@Controller("search")
@UseGuards(SessionGuard)
export class SearchController {
  /**
   * Tenant token (ADR 0009): the searchRules filter embeds the user's exact
   * read set. Enforcement happens inside Meilisearch on every query. Users
   * past the grant guardrail get { mode: "proxy" } and query via POST /search.
   */
  @Get("token")
  async token(@Req() req: AuthedRequest): Promise<
    ApiOk<
      | { mode: "direct"; token: string; host: string; indexUid: string; expiresAt: string }
      | { mode: "proxy" }
    >
  > {
    const { filter, grantCount } = await buildReadFilter(req.user.id);
    if (grantCount > GRANT_GUARDRAIL) return ok({ mode: "proxy" });

    const key = await getSearchKey();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
    const token = await generateTenantToken({
      apiKey: key.key,
      apiKeyUid: key.uid,
      searchRules: { [SEARCH_INDEX]: { filter } },
      expiresAt,
    });
    return ok({
      mode: "direct",
      token,
      host: env.meilisearch.url,
      indexUid: SEARCH_INDEX,
      expiresAt: expiresAt.toISOString(),
    });
  }

  /** Proxied search for guardrailed users — same read-set filter, applied here. */
  @Post()
  async query(
    @Body(new ZodValidationPipe(searchQuerySchema)) body: SearchQueryDto,
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<unknown>> {
    const { filter } = await buildReadFilter(req.user.id);
    const extra: string[] = [];
    if (body.spaceIds?.length) {
      extra.push(`space_id IN [${body.spaceIds.map((id) => `"${id}"`).join(", ")}]`);
    }
    if (body.updatedAfter) extra.push(`updated_at >= ${body.updatedAfter}`);

    const result = await masterClient()
      .index(SEARCH_INDEX)
      .search(body.q, {
        limit: 20,
        // The read-set filter is non-negotiable; UI facets AND on top of it.
        filter: [`(${filter})`, ...extra],
        facets: ["space_id"],
        attributesToHighlight: ["title", "text"],
        highlightPreTag: "__HL__",
        highlightPostTag: "__/HL__",
        attributesToCrop: ["text"],
        cropLength: 28,
      });
    return ok(result);
  }
}
