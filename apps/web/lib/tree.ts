import type { PageSummaryDto } from "@angy/shared";

export interface TreeNode {
  id: string;
  title: string;
  href: string;
  children: TreeNode[];
}

/** Ordered ids of one sibling group — roots when parentId is null. */
export function siblingIds(nodes: TreeNode[], parentId: string | null): string[] {
  if (parentId === null) return nodes.map((node) => node.id);
  for (const node of nodes) {
    if (node.id === parentId) return node.children.map((child) => child.id);
    const found = siblingIds(node.children, parentId);
    if (found.length > 0) return found;
  }
  return [];
}

function reorderSiblings(siblings: TreeNode[], id: string, afterId: string | null): TreeNode[] {
  const node = siblings.find((sibling) => sibling.id === id);
  if (!node) return siblings;
  const rest = siblings.filter((sibling) => sibling.id !== id);
  if (afterId === null) return [node, ...rest];
  const at = rest.findIndex((sibling) => sibling.id === afterId);
  if (at < 0) return siblings;
  return [...rest.slice(0, at + 1), node, ...rest.slice(at + 1)];
}

/**
 * Move `id` within its own sibling group so that it follows `afterId` (null =
 * first). The same operation the API performs, applied locally so the sidebar
 * responds to a drag before the round trip — and reverted wholesale if the
 * server disagrees.
 */
export function reorderTree(
  nodes: TreeNode[],
  parentId: string | null,
  id: string,
  afterId: string | null,
): TreeNode[] {
  if (parentId === null) return reorderSiblings(nodes, id, afterId);
  return nodes.map((node) =>
    node.id === parentId
      ? { ...node, children: reorderSiblings(node.children, id, afterId) }
      : { ...node, children: reorderTree(node.children, parentId, id, afterId) },
  );
}

/** Rebuild the nested page tree from the API's flat parentId list. */
export function buildTree(pages: PageSummaryDto[], spaceKey: string): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  for (const page of pages) {
    nodes.set(page.id, {
      id: page.id,
      title: page.title,
      href: `/s/${spaceKey}/${page.id}`,
      children: [],
    });
  }
  const roots: TreeNode[] = [];
  for (const page of pages) {
    const node = nodes.get(page.id)!;
    const parent = page.parentId ? nodes.get(page.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}
