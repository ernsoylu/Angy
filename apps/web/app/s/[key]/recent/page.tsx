import { notFound } from "next/navigation";
import { PageListView } from "../../../../components/personal/PageListView";
import { getRecentPages, getSpaceByKey } from "../../../../lib/api";

/** Sidebar "Recent" — pages this user has read, newest first (Wave C). */
export default async function RecentPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const space = await getSpaceByKey(key);
  if (!space) notFound();
  const items = await getRecentPages(space.id);

  return (
    <PageListView
      title="Recent"
      subtitle={`Pages you've read in ${space.name}, most recent first`}
      spaceKey={key}
      items={items}
      timeLabel="Read"
      empty={{
        title: "Nothing read yet",
        body: "Pages you open in this space show up here, so you can get back to them without hunting through the tree.",
      }}
    />
  );
}
