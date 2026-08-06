import {
  ForbiddenException,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PermLevelDto } from "@angy/shared";
import type { AuthedRequest } from "../auth/session.guard";
import { checkPagePermission } from "./permissions.service";

export const PERM_LEVEL_KEY = "requiredPermLevel";

/** Declare the page permission a route needs; the page id must be the :id param. */
export const RequirePageLevel = (level: PermLevelDto) => SetMetadata(PERM_LEVEL_KEY, level);

@Injectable()
export class PagePermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<PermLevelDto | undefined>(
      PERM_LEVEL_KEY,
      context.getHandler(),
    );
    if (!required) return true;
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const pageId = request.params.id;
    if (typeof pageId !== "string" || pageId.length === 0) return true;
    const allowed = await checkPagePermission(request.user.id, pageId, required);
    if (!allowed) {
      throw new ForbiddenException("You don't have access to this page");
    }
    return true;
  }
}
