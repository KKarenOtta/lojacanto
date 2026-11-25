import { AuthorizationError, ContractError, UpstreamError } from "../../shared/errors.ts";

export const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const SCOPES = ["openid", "email", GMAIL_SEND_SCOPE];
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function createPkce(verifier = randomToken()): Promise<Pkce> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

export function authorizationUrl(
  client: OAuthClient,
  params: { state: string; challenge: string; loginHint: string },
): string {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: "S256",
    login_hint: params.loginHint,
  }).toString();
  return url.toString();
}

export interface IdentityClaims {
  email: string;
  emailVerified: boolean;
}

export function identityFromIdToken(
  idToken: string,
  clientId: string,
  now: Date = new Date(),
): IdentityClaims {
  const payload = idToken.split(".")[1];
  if (!payload) throw new ContractError("id_token", "malformed");
  let claims: Record<string, unknown>;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    claims = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0))),
    );
  } catch {
    throw new ContractError("id_token", "undecodable");
  }
  if (claims.aud !== clientId) throw new ContractError("id_token.aud", "foreign client");
  if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) {
    throw new ContractError("id_token.iss", "unexpected issuer");
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= now.getTime()) {
    throw new ContractError("id_token.exp", "expired");
  }
  if (typeof claims.email !== "string") throw new ContractError("id_token.email", "missing");
  return { email: claims.email.toLowerCase(), emailVerified: claims.email_verified === true };
}

export interface GrantedCredentials {
  refreshToken: string;
  identity: IdentityClaims;
}

async function postToken(
  body: Record<string, string>,
  doFetch: typeof fetch,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await doFetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new UpstreamError(0, true, `google token endpoint unreachable: ${(error as Error).name}`);
  }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (response.status === 400 && payload.error === "invalid_grant") {
    throw new AuthorizationError("google grant invalid");
  }
  if (!response.ok) {
    throw new UpstreamError(response.status, response.status >= 500, "google token request failed");
  }
  return payload;
}

export async function exchangeCode(
  client: OAuthClient,
  params: { code: string; verifier: string },
  doFetch: typeof fetch = fetch,
): Promise<GrantedCredentials> {
  const payload = await postToken({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code: params.code,
    code_verifier: params.verifier,
    grant_type: "authorization_code",
    redirect_uri: client.redirectUri,
  }, doFetch);
  const scopes = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
  if (!scopes.includes(GMAIL_SEND_SCOPE)) {
    throw new ContractError("scope", "gmail.send not granted");
  }
  if (typeof payload.refresh_token !== "string" || payload.refresh_token === "") {
    throw new ContractError("refresh_token", "missing");
  }
  if (typeof payload.id_token !== "string") throw new ContractError("id_token", "missing");
  return {
    refreshToken: payload.refresh_token,
    identity: identityFromIdToken(payload.id_token, client.clientId),
  };
}

export interface AccessToken {
  token: string;
  expiresAt: Date;
}

export async function refreshAccessToken(
  client: Pick<OAuthClient, "clientId" | "clientSecret">,
  refreshToken: string,
  doFetch: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<AccessToken> {
  const payload = await postToken({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }, doFetch);
  if (typeof payload.access_token !== "string" || typeof payload.expires_in !== "number") {
    throw new ContractError("access_token", "missing");
  }
  return {
    token: payload.access_token,
    expiresAt: new Date(now.getTime() + payload.expires_in * 1000),
  };
}
