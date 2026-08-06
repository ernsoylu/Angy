import type { PageSummaryDto } from "@angy/shared";

export interface TreeNode {
  id: string;
  title: string;
  href: string;
  children: TreeNode[];
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
