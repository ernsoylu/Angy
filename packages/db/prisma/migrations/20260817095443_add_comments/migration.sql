-- AlterEnum
ALTER TYPE "notification_kind" ADD VALUE 'COMMENT';

-- CreateTable
CREATE TABLE "comment_thread" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "page_id" UUID NOT NULL,
    "anchor_text" TEXT NOT NULL,
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by" BIGINT,
    "resolved_at" TIMESTAMP(3),
    "orphaned_at" TIMESTAMP(3),

    CONSTRAINT "comment_thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment" (
    "id" BIGSERIAL NOT NULL,
    "thread_id" UUID NOT NULL,
    "author_id" BIGINT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comment_thread_page_id_resolved_at_idx" ON "comment_thread"("page_id", "resolved_at");

-- CreateIndex
CREATE INDEX "comment_thread_id_created_at_idx" ON "comment"("thread_id", "created_at");

-- AddForeignKey
ALTER TABLE "comment_thread" ADD CONSTRAINT "comment_thread_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "comment_thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
