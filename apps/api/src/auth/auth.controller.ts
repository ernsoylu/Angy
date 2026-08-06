import { Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { ok } from "@angy/shared";
import type { ApiOk, UserDto } from "@angy/shared";
import { getPrisma } from "@angy/db";
import { env } from "../env";
import { getRedis } from "../redis";
import { OidcService } from "./oidc.service";
import {
  clearedSessionCookie,
  createSession,
  destroySession,
  parseCookies,
  SESSION_COOKIE,
  sessionCookie,
} from "./session";
import { SessionGuard, type AuthedRequest } from "./session.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly oidc: OidcService) {}

  @Get("login")
  async login(@Res() res: Response) {
    res.redirect(await this.oidc.beginLogin());
  }

  @Get("callback")
  async callback(@Req() req: Request, @Res() res: Response) {
    // openid-client validates the callback URL it is handed, so it has to be
    // the public one the IdP actually redirected the browser to — not the
    // address this process happens to listen on.
    const url = new URL(req.originalUrl, env.publicApiUrl());
    const identity = await this.oidc.completeLogin(url);
    const prisma = getPrisma();
    const bySubject = await prisma.appUser.findUnique({
      where: { oidcSubject: identity.subject },
    });
    // Unknown subject: link by verified email (the IdP is trusted — accounts
    // may be pre-provisioned by seeds or a directory), else first sign-in.
    const user = bySubject
      ? await prisma.appUser.update({
          where: { id: bySubject.id },
          data: { email: identity.email, displayName: identity.displayName },
        })
      : await prisma.appUser.upsert({
          where: { email: identity.email },
          update: { oidcSubject: identity.subject, displayName: identity.displayName },
          create: {
            oidcSubject: identity.subject,
            email: identity.email,
            displayName: identity.displayName,
          },
        });
    const sessionId = await createSession(getRedis(), user.id);
    res.setHeader("Set-Cookie", sessionCookie(sessionId, env.publicApiUrl().startsWith("https:")));
    res.redirect(env.webOrigin);
  }

  @Post("logout")
  async logout(@Req() req: Request, @Res() res: Response) {
    const sessionId = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (sessionId) await destroySession(getRedis(), sessionId);
    res.setHeader("Set-Cookie", clearedSessionCookie(env.publicApiUrl().startsWith("https:")));
    res.json(ok({ signedOut: true }));
  }

  @Get("me")
  @UseGuards(SessionGuard)
  me(@Req() req: AuthedRequest): ApiOk<UserDto> {
    return ok({
      id: req.user.id.toString(),
      email: req.user.email,
      displayName: req.user.displayName,
    });
  }
}
