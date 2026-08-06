-- Ancestor chain for a page, root first, ending at the page itself.
-- @param {String} $1:pageId
SELECT p.id, p.title, p.slug, pa.depth
FROM page_ancestor pa
JOIN page p ON p.id = pa.ancestor_id
WHERE pa.descendant_id = $1::uuid
ORDER BY pa.depth DESC
