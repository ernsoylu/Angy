-- Closure-table maintenance: register a new page under its parent.
-- For root pages, pass the page's own id as $1 (the SELECT matches nothing).
-- @param {String} $1:parentId
-- @param {String} $2:pageId
INSERT INTO page_ancestor (ancestor_id, descendant_id, depth)
SELECT ancestor_id, $2::uuid, depth + 1
FROM page_ancestor
WHERE descendant_id = $1::uuid
UNION ALL
SELECT $2::uuid, $2::uuid, 0
RETURNING descendant_id
