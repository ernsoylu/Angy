import { notFound } from "next/navigation";
import { TrashView } from "../../../../components/pageops/TrashView";
import { getSpaceByKey, getSpaceTrash } from "../../../../lib/api";

export default async function TrashPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const space = await getSpaceByKey(key);
  if (!space) notFound();
  const items = await getSpaceTrash(space.id);
  return <TrashView initial={items} spaceKey={key} />;
}
