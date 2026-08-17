import { notFound } from "next/navigation";
import { EditorView } from "../../../../../components/editor/EditorView";
import { RestrictedState } from "../../../../../components/ui/SystemState";
import { getMe } from "../../../../../lib/api";
import { getReaderPage, getReaderThreads } from "../../../../../lib/reader";

/** Edit-on-click: the editor and its WebSocket exist only behind this route. */
export default async function EditPage({
  params,
}: {
  params: Promise<{ key: string; pageId: string }>;
}) {
  const { key, pageId } = await params;
  const me = await getMe();
  const page = await getReaderPage(pageId, BigInt(me.id), "EDIT");
  if (!page) notFound();
  if (page === "forbidden") return <RestrictedState />;

  return (
    <EditorView
      pageId={pageId}
      title={page.title}
      version={page.version}
      spaceKey={key}
      breadcrumb={page.breadcrumb}
      user={{ id: me.id, name: me.displayName }}
      threads={await getReaderThreads(pageId)}
    />
  );
}
