import { Injectable } from "@nestjs/common";
import * as oidc from "openid-client";
import { randomBytes } from "node:crypto";
import { env } from "../env";
import { getRedis } from "../redis";

const STATE_TTL_SECONDS = 600;

export interface OidcIdentity {
  subject: string;
  email: string;
  displayName: string;
}

@Injectable()
export class OidcService {
  private config?: oidc.Configuration;

  private async configuration(): Promise<oidc.Configuration> {
    this.config ??= await oidc.discovery(
      new URL(env.oidc.issuerUrl()),
      env.oidc.clientId(),
      env.oidc.clientSecret(),
      undefined,
      // Keycloak/Authentik run over plain http in local dev only.
      env.oidc.issuerUrl().startsWith("http://") ? { execute: [oidc.allowInsecureRequests] } : {},
    );
    return this.config;
  }

  redirectUri(): string {
    return `http://localhost:${env.port}/auth/callback`;
  }

  /** Build the authorization URL; PKCE verifier is parked in Redis keyed by state. */
  async beginLogin(): Promise<string> {
    const config = await this.configuration();
    const state = randomBytes(16).toString("hex");
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    await getRedis().set(`oidc:state:${state}`, codeVerifier, "EX", STATE_TTL_SECONDS);
    return oidc
      .buildAuthorizationUrl(config, {
        redirect_uri: this.redirectUri(),
        scope: "openid profile email",
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      })
      .toString();
  }

  /** Complete the code exchange and return the verified identity claims. */
  async completeLogin(callbackUrl: URL): Promise<OidcIdentity> {
    const config = await this.configuration();
    const state = callbackUrl.searchParams.get("state") ?? "";
    const stateKey = `oidc:state:${state}`;
    const codeVerifier = await getRedis().get(stateKey);
    if (!codeVerifier) throw new Error("Unknown or expired OIDC state");
    await getRedis().del(stateKey);

    const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
      expectedState: state,
      pkceCodeVerifier: codeVerifier,
    });
    const claims = tokens.claims();
    if (!claims?.sub) throw new Error("OIDC response had no subject claim");
    const email = typeof claims.email === "string" ? claims.email : `${claims.sub}@unknown.local`;
    const displayName =
      (typeof claims.name === "string" && claims.name) ||
      (typeof claims.preferred_username === "string" && claims.preferred_username) ||
      email;
    return { subject: claims.sub, email, displayName };
  }
}
