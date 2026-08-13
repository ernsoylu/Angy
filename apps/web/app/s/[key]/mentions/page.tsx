import { notFound } from "next/navigation";
import { PageListView } from "../../../../components/personal/PageListView";
import { getMentionedPages, getSpaceByKey } from "../../../../lib/api";

/**
 * Sidebar "Mentions" — pages naming this user, from `block_index` (V2 H1).
 *
 * Space-scoped like Recent and Starred, for the same reason: the sidebar that
 * reaches it is. The workspace-wide inbox the roadmap describes is a separate
 * surface and needs notifications behind it to be worth opening.
 */
export default async function MentionsPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const space = await getSpaceByKey(key);
  if (!space) notFound();
  const items = await getMentionedPages(space.id);

  return (
    <PageListView
      title="Mentions"
      subtitle={`Pages in ${space.name} that mention you`}
      spaceKey={key}
      items={items}
      timeLabel="Updated"
      empty={{
        title: "No mentions yet",
        body: "When someone types @ and picks your name, that page shows up here. Nothing to set up — the list fills itself.",
      }}
    />
  );
}
