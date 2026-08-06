import { NextResponse, type NextRequest } from "next/server";
import { getPrisma } from "@angy/db";

/**
 * A *relative* Location, deliberately.
 *
 * `NextResponse.redirect` demands an absolute URL, and the obvious way to build
 * one — `new URL(path, request.url)` — reconstructs the host from the address
 * the server is listening on. Behind the tunnel that is `0.0.0.0:3000`, so the
 * browser is redirected somewhere that does not exist. Trusting
 * `X-Forwarded-Host` would work but adds a header the proxy must be trusted to
 * set. RFC 7231 permits a relative Location and the browser resolves it against
 * the URL it actually asked for, which is right by construction.
 */
const seeOther = (path: string) =>
  new NextResponse(null, { status: 307, headers: { Location: path } });

/**
 * Space-agnostic page permalink. `pageLink` nodes point here rather than at
 * `/s/{spaceKey}/{pageId}` so that moving a page between spaces does not
 * invalidate every document linking to it — the alternative is rewriting every
 * referring Y.Doc on a move, which needs a backlink index Angy does not have
 * until V2.
 *
 * Deliberately does no permission check. It only turns an id into the URL that
 * *does* check: the space route resolves the viewer's effective level and shows
 * the restricted state. Answering here would leak nothing extra (the id is
 * already in the caller's hand) and would duplicate the rule in a second place.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pageId: string }> },
) {
  const { pageId } = await params;
  const page = await getPrisma().page.findFirst({
    where: { id: pageId, deletedAt: null },
    select: { id: true, space: { select: { key: true } } },
  });
  // A trashed or hard-deleted target lands on the app's own 404 rather than a
  // redirect into a URL that would 404 anyway.
  if (!page) return seeOther("/not-found");
  return seeOther(`/s/${page.space.key}/${page.id}`);
}
