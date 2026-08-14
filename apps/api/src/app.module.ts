import { Module } from "@nestjs/common";
import { AuthController } from "./auth/auth.controller";
import { OidcService } from "./auth/oidc.service";
import { SessionGuard } from "./auth/session.guard";
import { HealthController } from "./health.controller";
import { AttachmentsController } from "./pages/attachments.controller";
import { ExportController } from "./pages/export.controller";
import { ImportController } from "./pages/import.controller";
import { PageOpsController } from "./pages/page-ops.controller";
import { PagePermissionsController } from "./pages/page-permissions.controller";
import { PagesController } from "./pages/pages.controller";
import { PersonalController } from "./pages/personal.controller";
import { TagsController } from "./pages/tags.controller";
import { TemplatesController } from "./pages/templates.controller";
import { RevisionsController } from "./pages/revisions.controller";
import { PagePermissionGuard } from "./permissions/page-permission.guard";
import { SearchController } from "./search/search.controller";
import { SpaceAdminController } from "./spaces/space-admin.controller";
import { SpacesController } from "./spaces/spaces.controller";
import { UsersController } from "./users/users.controller";

@Module({
  controllers: [
    HealthController,
    AuthController,
    SpacesController,
    SpaceAdminController,
    PagesController,
    PagePermissionsController,
    RevisionsController,
    SearchController,
    AttachmentsController,
    PageOpsController,
    PersonalController,
    TagsController,
    TemplatesController,
    ExportController,
    ImportController,
    UsersController,
  ],
  providers: [OidcService, SessionGuard, PagePermissionGuard],
})
export class AppModule {}
