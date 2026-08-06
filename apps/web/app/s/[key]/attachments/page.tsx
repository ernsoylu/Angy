import { notFound } from "next/navigation";
import { AttachmentsView } from "../../../../components/attachments/AttachmentsView";
import { getSpaceAttachments, getSpaceByKey, getSpacePages } from "../../../../lib/api";

/** Space media library per frontend.pen frame 8. */
export default async function AttachmentsPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const space = await getSpaceByKey(key);
  if (!space) notFound();
  const [attachments, pages] = await Promise.all([
    getSpaceAttachments(space.id),
    getSpacePages(space.id),
  ]);

  return (
    <AttachmentsView
      initial={attachments}
      pages={pages.map((p) => ({ id: p.id, title: p.title }))}
    />
  );
}
