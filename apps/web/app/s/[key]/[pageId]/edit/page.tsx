import { notFound } from "next/navigation";
import { EditorView } from "../../../../../components/editor/EditorView";
import { RestrictedState } from "../../../../../components/ui/SystemState";
import { getMe, getRealtimeToken } from "../../../../../lib/api";
import { getReaderPage } from "../../../../../lib/reader";

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
  const realtime = await getRealtimeToken(pageId);

  return (
    <EditorView
      pageId={pageId}
      token={realtime.token}
      title={page.title}
      version={page.version}
      spaceKey={key}
      breadcrumb={page.breadcrumb}
      user={{ name: me.displayName }}
    />
  );
}
