-- All live pages under a root (including the root itself), shallowest first.
-- @param {String} $1:rootId
SELECT p.id, p.title, p.slug, p.parent_id AS "parentId", pa.depth
FROM page_ancestor pa
JOIN page p ON p.id = pa.descendant_id
WHERE pa.ancestor_id = $1::uuid
  AND p.deleted_at IS NULL
-- (ord, id): the sibling order someone chose, with the tie-break that makes
-- two pages sharing a key come back the same way for everyone.
ORDER BY pa.depth, p.ord, p.id
