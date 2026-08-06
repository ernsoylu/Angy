import { notFound } from "next/navigation";
import { MeView } from "../../../../components/personal/MeView";
import {
  getMe,
  getRecentPages,
  getSpaceByKey,
  getStarredPages,
} from "../../../../lib/api";

/** Mobile "Me" tab (frame E) — profile, personal lists, sign-out. */
export default async function MePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const [me, space] = await Promise.all([getMe(), getSpaceByKey(key)]);
  if (!space) notFound();
  const [recent, starred] = await Promise.all([
    getRecentPages(space.id),
    getStarredPages(space.id),
  ]);

  return (
    <MeView
      user={{ name: me.displayName, email: me.email }}
      spaceKey={key}
      recent={recent}
      starred={starred}
    />
  );
}
