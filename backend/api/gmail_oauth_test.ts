import assert from "node:assert/strict";
import { createLogger } from "../shared/log.ts";
import { configFromEnv, createGmailOAuthHandler, type GmailOAuthDeps } from "./gmail_oauth.ts";

const BASE = "https://ref.supabase.co/functions/v1/gmail-oauth";
const STORE = "10000000-0000-0000-0000-000000000001";
const config = {
  client: { clientId: "client", clientSecret: "secret", redirectUri: `${BASE}/callback` },
  sender: "lojacantoutil@gmail.com",
  storeId: STORE,
};

function setup(overrides: Partial<GmailOAuthDeps> = {}) {
  const lines: string[] = [];
  const stored: string[][] = [];
  const handler = createGmailOAuthHandler({
    config,
    logger: createLogger({}, (line) => lines.push(line)),
    storeCredentials: (storeId, address, token) => {
      stored.push([storeId, address, token]);
      return Promise.resolve("sender-1");
    },
    exchange: () =>
      Promise.resolve({
        refreshToken: "refresh-secret",
        identity: { email: "lojacantoutil@gmail.com", emailVerified: true },
      }),
    ...overrides,
  });
  return { handler, lines, stored };
}

async function start(handler: (r: Request) => Promise<Response>) {
  const response = await handler(new Request(`${BASE}/start`));
  const cookie = response.headers.get("set-cookie")!;
  const value = cookie.split(";")[0]!;
  const state = new URL(response.headers.get("location")!).searchParams.get("state")!;
  return { response, cookie, value, state };
}

function callback(query: string, cookie?: string): Request {
  return new Request(`${BASE}/callback?${query}`, {
    headers: cookie ? { cookie: `outro=1; ${cookie}` } : {},
  });
}

Deno.test("início redireciona ao Google com estado em cookie restrito", async () => {
  const { handler } = setup();
  const { response, cookie, state } = await start(handler);
  assert.equal(response.status, 302);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(cookie, /Path=\/functions\/v1\/gmail-oauth; Max-Age=600/);
  assert.ok(cookie.includes(`pulso_gmail_oauth=${state}.`));
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.searchParams.get("login_hint"), "lojacantoutil@gmail.com");
  assert.ok(location.searchParams.get("code_challenge"));
});

Deno.test("retorno válido grava a credencial sem expor o token", async () => {
  const { handler, lines, stored } = setup();
  const { value, state } = await start(handler);
  const response = await handler(callback(`state=${state}&code=abc`, value));
  assert.equal(response.status, 200);
  assert.deepEqual(stored, [[STORE, "lojacantoutil@gmail.com", "refresh-secret"]]);
  assert.match(response.headers.get("set-cookie")!, /Max-Age=0/);
  const output = lines.join("\n") + (await response.text());
  assert.ok(!output.includes("refresh-secret"));
});

Deno.test("retorno sem estado correspondente é recusado", async () => {
  const { handler, stored } = setup();
  const { value } = await start(handler);
  assert.equal((await handler(callback("state=forjado&code=abc", value))).status, 400);
  assert.equal((await handler(callback("state=x&code=abc"))).status, 400);
  assert.equal(
    (await handler(callback("state=x", "pulso_gmail_oauth=curto.curto"))).status,
    400,
  );
  assert.equal(stored.length, 0);
});

Deno.test("recusa conta diferente, negação e código ausente", async () => {
  const other = setup({
    exchange: () =>
      Promise.resolve({
        refreshToken: "r",
        identity: { email: "outra@gmail.com", emailVerified: true },
      }),
  });
  let flow = await start(other.handler);
  assert.equal(
    (await other.handler(callback(`state=${flow.state}&code=a`, flow.value))).status,
    403,
  );
  assert.equal(other.stored.length, 0);

  const unverified = setup({
    exchange: () =>
      Promise.resolve({
        refreshToken: "r",
        identity: { email: "lojacantoutil@gmail.com", emailVerified: false },
      }),
  });
  flow = await start(unverified.handler);
  assert.equal(
    (await unverified.handler(callback(`state=${flow.state}&code=a`, flow.value))).status,
    403,
  );

  const { handler } = setup();
  flow = await start(handler);
  assert.equal(
    (await handler(callback(`state=${flow.state}&error=access_denied`, flow.value))).status,
    400,
  );
  assert.equal((await handler(callback(`state=${flow.state}`, flow.value))).status, 400);
});

Deno.test("falhas de troca e de gravação não salvam nada", async () => {
  const failing = setup({ exchange: () => Promise.reject(new Error("boom")) });
  let flow = await start(failing.handler);
  assert.equal(
    (await failing.handler(callback(`state=${flow.state}&code=a`, flow.value))).status,
    502,
  );

  const unavailable = setup({ storeCredentials: () => Promise.reject(new Error("db")) });
  flow = await start(unavailable.handler);
  assert.equal(
    (await unavailable.handler(callback(`state=${flow.state}&code=a`, flow.value))).status,
    503,
  );
});

Deno.test("rotas e métodos fora do fluxo", async () => {
  const { handler } = setup();
  assert.equal((await handler(new Request(`${BASE}/start`, { method: "POST" }))).status, 405);
  assert.equal((await handler(new Request(`${BASE}/outra`))).status, 404);
  const unconfigured = createGmailOAuthHandler({
    config: null,
    logger: createLogger({}, () => {}),
    storeCredentials: () => Promise.resolve(""),
  });
  assert.equal((await unconfigured(new Request(`${BASE}/start`))).status, 503);
});

Deno.test("configuração exige todos os valores e URI HTTPS", () => {
  const env: Record<string, string> = {
    GOOGLE_OAUTH_CLIENT_ID: "client",
    GOOGLE_OAUTH_CLIENT_SECRET: "secret",
    GMAIL_OAUTH_REDIRECT_URI: `${BASE}/callback`,
    GMAIL_SENDER: "LojaCantoUtil@gmail.com",
    STORE_ID: STORE,
  };
  assert.equal(configFromEnv((name) => env[name])?.sender, "lojacantoutil@gmail.com");
  assert.equal(
    configFromEnv((name) => ({ ...env, GMAIL_OAUTH_REDIRECT_URI: "http://x" })[name]),
    null,
  );
  assert.equal(configFromEnv((name) => ({ ...env, STORE_ID: "loja" })[name]), null);
  assert.equal(configFromEnv((name) => ({ ...env, GOOGLE_OAUTH_CLIENT_SECRET: "" })[name]), null);
});
