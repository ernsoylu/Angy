-- Move step 1: sever every closure link between the page's subtree and its
-- old ancestors (subtree-internal rows, including self-rows, survive).
-- @param {String} $1:pageId
DELETE FROM page_ancestor
WHERE descendant_id IN (SELECT descendant_id FROM page_ancestor WHERE ancestor_id = $1::uuid)
  AND ancestor_id NOT IN (SELECT descendant_id FROM page_ancestor WHERE ancestor_id = $1::uuid)
RETURNING descendant_id
