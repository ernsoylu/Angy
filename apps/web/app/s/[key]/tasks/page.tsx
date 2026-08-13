import { notFound } from "next/navigation";
import { TasksView } from "../../../../components/personal/TasksView";
import { getMe, getSpaceByKey, getSpaceTasks } from "../../../../lib/api";

/**
 * The tasks board (V2 H1) — the `block_index` consumer that reads a row's body
 * rather than what it points at, which is why the projection is one row per
 * actionable node rather than one per (page, entity).
 */
export default async function TasksPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const space = await getSpaceByKey(key);
  if (!space) notFound();
  const [tasks, me] = await Promise.all([getSpaceTasks(space.id), getMe()]);

  return (
    <TasksView
      tasks={tasks}
      spaceKey={key}
      spaceName={space.name}
      me={me.displayName}
    />
  );
}
