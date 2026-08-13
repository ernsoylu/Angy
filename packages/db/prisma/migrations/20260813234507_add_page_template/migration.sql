-- CreateTable
CREATE TABLE "page_template" (
    "id" BIGSERIAL NOT NULL,
    "space_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "document_json" JSONB NOT NULL,
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_template_space_id_idx" ON "page_template"("space_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_template_space_id_name_key" ON "page_template"("space_id", "name");

-- AddForeignKey
ALTER TABLE "page_template" ADD CONSTRAINT "page_template_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
