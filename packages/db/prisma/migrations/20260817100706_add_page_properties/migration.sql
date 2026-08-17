-- CreateEnum
CREATE TYPE "property_type" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'SELECT', 'CHECKBOX', 'USER');

-- CreateTable
CREATE TABLE "page_property" (
    "id" BIGSERIAL NOT NULL,
    "space_id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "property_type" NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ord" TEXT NOT NULL,
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_property_value" (
    "page_id" UUID NOT NULL,
    "property_id" BIGINT NOT NULL,
    "text_value" TEXT,
    "number_value" DOUBLE PRECISION,
    "date_value" TIMESTAMP(3),
    "checkbox_value" BOOLEAN,
    "user_value" BIGINT,
    "updated_by" BIGINT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "page_property_value_pkey" PRIMARY KEY ("page_id","property_id")
);

-- CreateTable
CREATE TABLE "page_database" (
    "page_id" UUID NOT NULL,
    "columns" BIGINT[] DEFAULT ARRAY[]::BIGINT[],
    "filters" JSONB NOT NULL DEFAULT '[]',
    "sorts" JSONB NOT NULL DEFAULT '[]',
    "created_by" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_database_pkey" PRIMARY KEY ("page_id")
);

-- CreateIndex
CREATE INDEX "page_property_space_id_ord_idx" ON "page_property"("space_id", "ord");

-- CreateIndex
CREATE UNIQUE INDEX "page_property_space_id_name_key" ON "page_property"("space_id", "name");

-- CreateIndex
CREATE INDEX "page_property_value_property_id_text_value_idx" ON "page_property_value"("property_id", "text_value");

-- CreateIndex
CREATE INDEX "page_property_value_property_id_number_value_idx" ON "page_property_value"("property_id", "number_value");

-- CreateIndex
CREATE INDEX "page_property_value_property_id_date_value_idx" ON "page_property_value"("property_id", "date_value");

-- AddForeignKey
ALTER TABLE "page_property" ADD CONSTRAINT "page_property_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_property_value" ADD CONSTRAINT "page_property_value_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_property_value" ADD CONSTRAINT "page_property_value_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "page_property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_database" ADD CONSTRAINT "page_database_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
