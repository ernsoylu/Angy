import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { Request } from "express";
import { getPrisma, type AppUser } from "@angy/db";
import { getRedis } from "../redis";
import { resolveSessionUser } from "./session";

export interface AuthedRequest extends Request {
  user: AppUser;
}

@Injectable()
export class SessionGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const userId = await resolveSessionUser(getRedis(), request.headers.cookie);
    if (userId === null) throw new UnauthorizedException("Sign in to continue");
    const user = await getPrisma().appUser.findUnique({ where: { id: userId } });
    if (!user || user.deactivatedAt) throw new UnauthorizedException("Sign in to continue");
    request.user = user;
    return true;
  }
}
