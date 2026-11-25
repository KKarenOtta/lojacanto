import assert from "node:assert/strict";
import { AuthorizationError, ContractError, UpstreamError } from "../../shared/errors.ts";
import {
  authorizationUrl,
  createPkce,
  exchangeCode,
  GMAIL_SEND_SCOPE,
  identityFromIdToken,
  randomToken,
  refreshAccessToken,
  TOKEN_ENDPOINT,
} from "./google_oauth.ts";

const client = {
  clientId: "client.apps.googleusercontent.com",
  clientSecret: "secret-fixture",
  redirectUri: "https://ref.supabase.co/functions/v1/gmail-oauth/callback",
};
const now = new Date("2026-11-28T12:00:00Z");

function idToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${encode({ alg: "RS256" })}.${encode(claims)}.signature`;
}

const validClaims = {
  aud: client.clientId,
  iss: "https://accounts.google.com",
  exp: now.getTime() / 1000 + 3600,
  email: "LojaCantoUtil@gmail.com",
  email_verified: true,
};

function tokenFetch(status: number, body: unknown, seen: URLSearchParams[] = []): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), TOKEN_ENDPOINT);
    seen.push(new URLSearchParams(String(init?.body)));
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as typeof fetch;
}

Deno.test("PKCE usa SHA-256 do verificador (RFC 7636, apêndice B)", async () => {
  const pkce = await createPkce("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  assert.equal(pkce.challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  assert.match(randomToken(), /^[A-Za-z0-9_-]{43}$/);
});

Deno.test("URL de autorização pede acesso offline, consentimento e apenas envio", () => {
  const url = new URL(authorizationUrl(client, {
    state: "s",
    challenge: "c",
    loginHint: "lojacantoutil@gmail.com",
  }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), `openid email ${GMAIL_SEND_SCOPE}`);
});

Deno.test("identidade do ID token valida audiência, emissor e validade", () => {
  assert.deepEqual(identityFromIdToken(idToken(validClaims), client.clientId, now), {
    email: "lojacantoutil@gmail.com",
    emailVerified: true,
  });
  for (
    const claims of [
      { ...validClaims, aud: "outro" },
      { ...validClaims, iss: "https://evil.test" },
      { ...validClaims, exp: now.getTime() / 1000 - 1 },
      { ...validClaims, email: undefined },
    ]
  ) {
    assert.throws(() => identityFromIdToken(idToken(claims), client.clientId, now), ContractError);
  }
  assert.throws(() => identityFromIdToken("sem-pontos", client.clientId, now), ContractError);
  assert.throws(() => identityFromIdToken("a.@@@.b", client.clientId, now), ContractError);
});

Deno.test("troca do código envia verificador e exige escopo e refresh token", async () => {
  const seen: URLSearchParams[] = [];
  const granted = await exchangeCode(
    client,
    { code: "code-1", verifier: "verifier-1" },
    tokenFetch(200, {
      access_token: "a",
      expires_in: 3599,
      refresh_token: "r",
      scope: `openid ${GMAIL_SEND_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
      id_token: idToken({ ...validClaims, exp: Date.now() / 1000 + 3600 }),
    }, seen),
  );
  assert.equal(granted.refreshToken, "r");
  assert.equal(seen[0]!.get("code_verifier"), "verifier-1");
  assert.equal(seen[0]!.get("grant_type"), "authorization_code");

  await assert.rejects(
    exchangeCode(client, { code: "c", verifier: "v" }, tokenFetch(200, { scope: "openid" })),
    ContractError,
  );
  await assert.rejects(
    exchangeCode(
      client,
      { code: "c", verifier: "v" },
      tokenFetch(200, { scope: GMAIL_SEND_SCOPE }),
    ),
    ContractError,
  );
  await assert.rejects(
    exchangeCode(
      client,
      { code: "c", verifier: "v" },
      tokenFetch(200, { scope: GMAIL_SEND_SCOPE, refresh_token: "r" }),
    ),
    ContractError,
  );
});

Deno.test("renovação calcula expiração e distingue concessão inválida", async () => {
  const token = await refreshAccessToken(
    client,
    "r",
    tokenFetch(200, { access_token: "a2", expires_in: 3599 }),
    now,
  );
  assert.deepEqual(token, { token: "a2", expiresAt: new Date(now.getTime() + 3_599_000) });

  await assert.rejects(
    refreshAccessToken(client, "r", tokenFetch(400, { error: "invalid_grant" })),
    AuthorizationError,
  );
  await assert.rejects(
    refreshAccessToken(client, "r", tokenFetch(503, {})),
    (error: unknown) => error instanceof UpstreamError && error.retryable,
  );
  await assert.rejects(
    refreshAccessToken(client, "r", tokenFetch(200, { access_token: "a" })),
    ContractError,
  );
  await assert.rejects(
    refreshAccessToken(client, "r", (() => Promise.reject(new TypeError("x"))) as typeof fetch),
    (error: unknown) => error instanceof UpstreamError && error.status === 0,
  );
});
