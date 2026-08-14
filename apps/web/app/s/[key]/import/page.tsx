import { notFound } from "next/navigation";
import { satisfies } from "@angy/shared";
import { ImportView } from "../../../../components/spaces/ImportView";
import { RestrictedState } from "../../../../components/ui/SystemState";
import { getMe, getSpaceByKey, getSpaceMembers } from "../../../../lib/api";

/**
 * Import (V2 H2). Gated on EDIT, the same level the API requires — importing
 * is creating pages, so anyone who can write here can bring content in.
 *
 * Discovery sits in space settings rather than the sidebar: adopting a wiki is
 * something a space's owner does once, not a place anyone navigates to weekly.
 * The route stands on its own, so a link handed to an editor still works.
 */
export default async function ImportPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const space = await getSpaceByKey(key);
  if (!space) notFound();

  const [me, members] = await Promise.all([getMe(), getSpaceMembers(space.id)]);
  const mine = members.find((member) => member.userId === me.id);
  if (!satisfies(mine?.permLevel ?? null, "EDIT")) return <RestrictedState />;

  return <ImportView space={space} />;
}
