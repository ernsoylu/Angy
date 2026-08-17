-- Sibling ordering (V2 H5.1). Until now a page's place among its siblings was
-- `created_at`, which is not an order anyone chose.
--
-- `ord` is a fractional index (`orderKeyBetween` in @angy/shared): a string
-- compared lexicographically, so moving one page updates one row and never
-- renumbers its siblings.
--
-- COLLATE "C" is not decoration. The keys mix digits with both letter cases
-- and a `.` separator, and a locale collation folds case and ignores
-- punctuation — under en_US.UTF-8 the database would order `V00001.l` and
-- `V00002` differently from the code that computed them, and the tree would
-- come back subtly shuffled on one deployment and not another. "C" is byte
-- order, which is what the generator assumes.

-- AlterTable
ALTER TABLE "page" ADD COLUMN "ord" TEXT COLLATE "C";

-- Backfill: keep the order that was already on screen (created_at), so no
-- existing tree visibly reshuffles the moment this lands.
CREATE FUNCTION "angy_backfill_order_key"(n BIGINT) RETURNS TEXT AS $$
DECLARE
  digits CONSTANT TEXT := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  out TEXT := '';
  rest BIGINT := n;
BEGIN
  FOR i IN 1..6 LOOP
    out := substr(digits, (rest % 62)::int + 1, 1) || out;
    rest := rest / 62;
  END LOOP;
  RETURN out;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 28400117792 is "V00000" — the mid-range start ORDER_KEY_START encodes, so
-- that prepending is as cheap as appending for a backfilled tree too.
WITH ordered AS (
  SELECT id,
         row_number() OVER (PARTITION BY space_id, parent_id ORDER BY created_at, id) - 1 AS seq
  FROM "page"
)
UPDATE "page" p
SET "ord" = "angy_backfill_order_key"(28400117792 + o.seq)
FROM ordered o
WHERE o.id = p.id;

DROP FUNCTION "angy_backfill_order_key"(BIGINT);

ALTER TABLE "page" ALTER COLUMN "ord" SET NOT NULL;

-- CreateIndex
CREATE INDEX "page_parent_id_ord_idx" ON "page"("parent_id", "ord");

-- CreateIndex
CREATE INDEX "page_space_id_ord_idx" ON "page"("space_id", "ord");
