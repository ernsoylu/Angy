import { notFound } from "next/navigation";
import { satisfies } from "@angy/shared";
import { SpaceSettingsView } from "../../../../components/spaces/SpaceSettingsView";
import { RestrictedState } from "../../../../components/ui/SystemState";
import {
  getSpaceByKey,
  getSpaceHome,
  getSpaceMembers,
  getMe,
} from "../../../../lib/api";

/**
 * Space settings (frame 12). ADMIN-gated: the frame's restricted state is the
 * whole screen, not one disabled button — there is no Owner tier above Admin,
 * so an editor simply has no business here.
 */
export default async function SpaceSettingsPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const space = await getSpaceByKey(key);
  if (!space) notFound();

  const [me, members, home] = await Promise.all([
    getMe(),
    getSpaceMembers(space.id),
    getSpaceHome(space.id),
  ]);
  const mine = members.find((member) => member.userId === me.id);
  if (!satisfies(mine?.permLevel ?? null, "ADMIN")) return <RestrictedState />;

  return (
    <SpaceSettingsView space={space} members={members} pageCount={home.stats.pages} />
  );
}
