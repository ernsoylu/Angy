-- All live pages under a root (including the root itself), shallowest first.
-- @param {String} $1:rootId
SELECT p.id, p.title, p.slug, p.parent_id AS "parentId", pa.depth
FROM page_ancestor pa
JOIN page p ON p.id = pa.descendant_id
WHERE pa.ancestor_id = $1::uuid
  AND p.deleted_at IS NULL
ORDER BY pa.depth, p.created_at
