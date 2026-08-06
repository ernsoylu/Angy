import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { MeiliSearch } from "meilisearch";
import { generateTenantToken } from "meilisearch/token";
import { getPrisma } from "@angy/db";
import { ok, type ApiOk } from "@angy/shared";
import { env } from "../env";
import { SessionGuard, type AuthedRequest } from "../auth/session.guard";

const TOKEN_TTL_MS = 15 * 60 * 1000;
const SEARCH_INDEX = "pages";

let searchKey: { key: string; uid: string } | undefined;

/**
 * The master key exists only here and in the worker; browsers and the web
 * server get short-lived tenant tokens minted from the default search key.
 */
async function getSearchKey(): Promise<{ key: string; uid: string }> {
  if (searchKey) return searchKey;
  const client = new MeiliSearch({
    host: env.meilisearch.url,
    apiKey: env.meilisearch.apiKey,
  });
  const { results } = await client.getKeys();
  const found = results.find(
    (key) => key.actions.includes("search") && key.actions.length === 1,
  );
  if (!found) throw new Error("Meilisearch default search key not found");
  searchKey = { key: found.key, uid: found.uid };
  return searchKey;
}

@Controller("search")
@UseGuards(SessionGuard)
export class SearchController {
  /**
   * Tenant token (ADR 0009): the searchRules filter embeds the user's exact
   * read set — spaces they can view ∪ pages explicitly granted. Enforcement
   * happens inside Meilisearch on every query; pagination and facet counts
   * stay correct with zero post-filtering.
   */
  @Get("token")
  async token(
    @Req() req: AuthedRequest,
  ): Promise<ApiOk<{ token: string; host: string; indexUid: string; expiresAt: string }>> {
    const prisma = getPrisma();
    const [spaces, grants] = await Promise.all([
      prisma.space.findMany({
        where: {
          OR: [{ visibility: "PUBLIC" }, { members: { some: { userId: req.user.id } } }],
        },
        select: { id: true },
      }),
      prisma.pagePermission.findMany({
        where: { userId: req.user.id },
        select: { pageId: true },
      }),
    ]);

    const spaceIds = spaces.map((s) => `"${s.id.toString()}"`).join(", ");
    const pageIds = grants.map((g) => `"${g.pageId}"`).join(", ");
    const clauses = [
      ...(spaceIds ? [`space_id IN [${spaceIds}]`] : []),
      ...(pageIds ? [`page_id IN [${pageIds}]`] : []),
    ];
    // A user with no readable spaces and no grants gets a filter matching nothing.
    const filter = clauses.length > 0 ? clauses.join(" OR ") : 'space_id = "__none__"';

    const key = await getSearchKey();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
    const token = await generateTenantToken({
      apiKey: key.key,
      apiKeyUid: key.uid,
      searchRules: { [SEARCH_INDEX]: { filter } },
      expiresAt,
    });
    return ok({
      token,
      host: env.meilisearch.url,
      indexUid: SEARCH_INDEX,
      expiresAt: expiresAt.toISOString(),
    });
  }
}
