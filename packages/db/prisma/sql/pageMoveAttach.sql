-- Move step 2: link the new parent's ancestor chain to every subtree node.
-- @param {String} $1:newParentId
-- @param {String} $2:pageId
INSERT INTO page_ancestor (ancestor_id, descendant_id, depth)
SELECT supertree.ancestor_id, subtree.descendant_id, supertree.depth + subtree.depth + 1
FROM page_ancestor AS supertree
CROSS JOIN page_ancestor AS subtree
WHERE supertree.descendant_id = $1::uuid
  AND subtree.ancestor_id = $2::uuid
RETURNING descendant_id
