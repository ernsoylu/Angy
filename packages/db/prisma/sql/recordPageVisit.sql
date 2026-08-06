-- Throttled reading-history write behind the sidebar's Recent list.
-- The WHERE on the conflict path is what makes this safe to call from the
-- reader's RSC render: reload storms and route prefetches collapse into one
-- write per throttle window instead of one per request.
-- Returns a row only when it actually wrote.
-- @param {BigInt} $1:userId
-- @param {String} $2:pageId
-- @param {DateTime} $3:staleBefore
INSERT INTO page_visit (user_id, page_id, visited_at, visits)
VALUES ($1, $2::uuid, now(), 1)
ON CONFLICT (user_id, page_id) DO UPDATE
  SET visited_at = now(), visits = page_visit.visits + 1
  WHERE page_visit.visited_at < $3
RETURNING visited_at
