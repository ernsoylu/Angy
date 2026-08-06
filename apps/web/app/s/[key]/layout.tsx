import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "../../../components/shell/AppShell";
import { getMe, getSpaceByKey, getSpacePages } from "../../../lib/api";
import { buildTree } from "../../../lib/tree";

export default async function SpaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const [me, space] = await Promise.all([getMe(), getSpaceByKey(key)]);
  if (!space) notFound();
  const pages = await getSpacePages(space.id);

  return (
    <AppShell
      user={{ name: me.displayName }}
      space={{ id: space.id, key: space.key, name: space.name }}
      tree={buildTree(pages, space.key)}
    >
      {children}
    </AppShell>
  );
}
