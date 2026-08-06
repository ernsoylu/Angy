-- CreateTable
CREATE TABLE "page_visit" (
    "user_id" BIGINT NOT NULL,
    "page_id" UUID NOT NULL,
    "visited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visits" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "page_visit_pkey" PRIMARY KEY ("user_id","page_id")
);

-- CreateTable
CREATE TABLE "page_star" (
    "user_id" BIGINT NOT NULL,
    "page_id" UUID NOT NULL,
    "starred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_star_pkey" PRIMARY KEY ("user_id","page_id")
);

-- CreateIndex
CREATE INDEX "page_visit_user_id_visited_at_idx" ON "page_visit"("user_id", "visited_at" DESC);

-- CreateIndex
CREATE INDEX "page_star_user_id_starred_at_idx" ON "page_star"("user_id", "starred_at" DESC);

-- AddForeignKey
ALTER TABLE "page_visit" ADD CONSTRAINT "page_visit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_visit" ADD CONSTRAINT "page_visit_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_star" ADD CONSTRAINT "page_star_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_star" ADD CONSTRAINT "page_star_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
