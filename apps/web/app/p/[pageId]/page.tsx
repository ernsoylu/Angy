import { notFound, redirect } from "next/navigation";
import { getPrisma } from "@angy/db";

/**
 * Space-agnostic page permalink. `pageLink` nodes point here rather than at
 * `/s/{spaceKey}/{pageId}` so that moving a page between spaces does not
 * invalidate every document linking to it — the alternative is rewriting every
 * referring Y.Doc on a move, which needs a backlink index Angy lacks until V2.
 *
 * A page rather than a route handler, deliberately. As a route handler this
 * has to construct the redirect target itself, and every route to an absolute
 * URL runs through the address the server is *listening* on — `0.0.0.0:3000`
 * behind the tunnel — so the browser was sent somewhere that does not exist.
 * Returning a relative `Location` does not help: Next absolutizes it against
 * the same wrong origin. `redirect()` from a page is resolved by the framework
 * against the request the browser actually made, so there is no origin to get
 * wrong.
 *
 * Deliberately does no permission check. It only turns an id into the URL that
 * *does* check: the space route resolves the viewer's effective level and shows
 * the restricted state. Answering here would leak nothing extra — the caller
 * already holds the id — and would put the rule in a second place.
 */
export default async function PagePermalink({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const { pageId } = await params;
  const page = await getPrisma().page.findFirst({
    where: { id: pageId, deletedAt: null },
    select: { id: true, space: { select: { key: true } } },
  });
  // Trashed or hard-deleted lands on the app's own 404 rather than a redirect
  // into a URL that would 404 anyway.
  if (!page) notFound();
  redirect(`/s/${page.space.key}/${page.id}`);
}
