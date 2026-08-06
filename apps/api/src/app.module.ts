import { Module } from "@nestjs/common";
import { AuthController } from "./auth/auth.controller";
import { OidcService } from "./auth/oidc.service";
import { SessionGuard } from "./auth/session.guard";
import { HealthController } from "./health.controller";
import { AttachmentsController } from "./pages/attachments.controller";
import { PageOpsController } from "./pages/page-ops.controller";
import { PagePermissionsController } from "./pages/page-permissions.controller";
import { PagesController } from "./pages/pages.controller";
import { RevisionsController } from "./pages/revisions.controller";
import { PagePermissionGuard } from "./permissions/page-permission.guard";
import { SearchController } from "./search/search.controller";
import { SpacesController } from "./spaces/spaces.controller";

@Module({
  controllers: [
    HealthController,
    AuthController,
    SpacesController,
    PagesController,
    PagePermissionsController,
    RevisionsController,
    SearchController,
    AttachmentsController,
    PageOpsController,
  ],
  providers: [OidcService, SessionGuard, PagePermissionGuard],
})
export class AppModule {}
