import { notFound } from "next/navigation";
import { PageListView } from "../../../../components/personal/PageListView";
import { getSpaceByKey, getStarredPages } from "../../../../lib/api";

/** Sidebar "Starred" — pages this user has bookmarked (Wave C). */
export default async function StarredPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const space = await getSpaceByKey(key);
  if (!space) notFound();
  const items = await getStarredPages(space.id);

  return (
    <PageListView
      title="Starred"
      subtitle={`Pages you've starred in ${space.name}`}
      spaceKey={key}
      items={items}
      timeLabel="Starred"
      empty={{
        title: "Nothing starred yet",
        body: "Star a page from its info rail and it lands here — a short list you keep, separate from the space's tree.",
      }}
    />
  );
}
