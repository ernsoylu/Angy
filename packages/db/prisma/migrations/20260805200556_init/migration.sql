-- CreateEnum
CREATE TYPE "perm_level" AS ENUM ('VIEW', 'EDIT', 'FULL', 'ADMIN');

-- CreateEnum
CREATE TYPE "space_visibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateTable
CREATE TABLE "space" (
    "id" BIGSERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "space_visibility" NOT NULL DEFAULT 'PUBLIC',
    "default_perm_level" "perm_level" NOT NULL DEFAULT 'VIEW',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" BIGSERIAL NOT NULL,
    "oidc_subject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "deactivated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_member" (
    "space_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "perm_level" "perm_level" NOT NULL DEFAULT 'VIEW',
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_member_pkey" PRIMARY KEY ("space_id","user_id")
);

-- CreateTable
CREATE TABLE "page" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "space_id" BIGINT NOT NULL,
    "parent_id" UUID,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ydoc_s3_key" TEXT,
    "ydoc_state_vector" BYTEA,
    "document_json" JSONB,
    "rendered_html" TEXT,
    "text_extract" TEXT,
    "projection_updated_at" TIMESTAMP(3),
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_ancestor" (
    "ancestor_id" UUID NOT NULL,
    "descendant_id" UUID NOT NULL,
    "depth" INTEGER NOT NULL,

    CONSTRAINT "page_ancestor_pkey" PRIMARY KEY ("ancestor_id","descendant_id")
);

-- CreateTable
CREATE TABLE "page_permission" (
    "page_id" UUID NOT NULL,
    "user_id" BIGINT NOT NULL,
    "perm_level" "perm_level" NOT NULL,
    "granted_by" BIGINT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_permission_pkey" PRIMARY KEY ("page_id","user_id")
);

-- CreateTable
CREATE TABLE "page_revision" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "page_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "revision_s3_key" TEXT NOT NULL,
    "state_vector" BYTEA,
    "label" TEXT,
    "size_bytes" BIGINT,
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment" (
    "id" BIGSERIAL NOT NULL,
    "page_id" UUID,
    "sha256" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "thumbnail_s3_key" TEXT,
    "uploaded_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "space_key_key" ON "space"("key");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_oidc_subject_key" ON "app_user"("oidc_subject");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE INDEX "page_space_id_idx" ON "page"("space_id");

-- CreateIndex
CREATE INDEX "page_parent_id_idx" ON "page"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_space_id_slug_key" ON "page"("space_id", "slug");

-- CreateIndex
CREATE INDEX "page_ancestor_descendant_id_idx" ON "page_ancestor"("descendant_id");

-- CreateIndex
CREATE INDEX "page_revision_page_id_created_at_idx" ON "page_revision"("page_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "page_revision_page_id_version_key" ON "page_revision"("page_id", "version");

-- CreateIndex
CREATE INDEX "attachment_sha256_idx" ON "attachment"("sha256");

-- AddForeignKey
ALTER TABLE "space_member" ADD CONSTRAINT "space_member_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_member" ADD CONSTRAINT "space_member_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page" ADD CONSTRAINT "page_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page" ADD CONSTRAINT "page_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_ancestor" ADD CONSTRAINT "page_ancestor_ancestor_id_fkey" FOREIGN KEY ("ancestor_id") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_ancestor" ADD CONSTRAINT "page_ancestor_descendant_id_fkey" FOREIGN KEY ("descendant_id") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_permission" ADD CONSTRAINT "page_permission_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_permission" ADD CONSTRAINT "page_permission_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_revision" ADD CONSTRAINT "page_revision_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "page"("id") ON DELETE SET NULL ON UPDATE CASCADE;
