-- CreateEnum
CREATE TYPE "block_ref_kind" AS ENUM ('PAGE_LINK');

-- CreateTable
CREATE TABLE "block_index" (
    "page_id" UUID NOT NULL,
    "ord" INTEGER NOT NULL,
    "kind" "block_ref_kind" NOT NULL,
    "target_page_id" UUID,
    "target_user_id" BIGINT,
    "payload" JSONB,

    CONSTRAINT "block_index_pkey" PRIMARY KEY ("page_id","ord")
);

-- CreateIndex
CREATE INDEX "block_index_target_page_id_idx" ON "block_index"("target_page_id");

-- CreateIndex
CREATE INDEX "block_index_target_user_id_idx" ON "block_index"("target_user_id");

-- AddForeignKey
ALTER TABLE "block_index" ADD CONSTRAINT "block_index_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_index" ADD CONSTRAINT "block_index_target_page_id_fkey" FOREIGN KEY ("target_page_id") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "block_index" ADD CONSTRAINT "block_index_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
