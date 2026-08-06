-- AlterTable
ALTER TABLE "space" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "deleted_by" BIGINT;
