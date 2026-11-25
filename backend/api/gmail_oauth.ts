import {
  authorizationUrl,
  createPkce,
  exchangeCode,
  type GrantedCredentials,
  type OAuthClient,
  randomToken,
} from "../integrations/email/google_oauth.ts";
import { createRpc } from "../integrations/supabase/rpc.ts";
import { correlationId } from "../shared/http.ts";
import { createLogger, type Logger } from "../shared/log.ts";

const COOKIE = "pulso_gmail_oauth";
const COOKIE_PATH = "/functions/v1/gmail-oauth";
const STATE_TTL_SECONDS = 600;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface GmailOAuthConfig {
  client: OAuthClient;
  sender: string;
  storeId: string;
}

export interface GmailOAuthDeps {
  config: GmailOAuthConfig | null;
  storeCredentials: (storeId: string, address: string, refreshToken: string) => Promise<string>;
  exchange?: (code: string, verifier: string) => Promise<GrantedCredentials>;
  logger: Logger;
}

function text(body: string, status: number, headers: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

function stateCookie(value: string, maxAge: number): string {
  return `${COOKIE}=${value}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request: Request): { state: string; verifier: string } | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, value] = part.trim().split("=", 2);
    if (name !== COOKIE || !value) continue;
    const [state, verifier] = value.split(".");
    if (state && verifier && TOKEN.test(state) && TOKEN.test(verifier)) return { state, verifier };
  }
  return null;
}

function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function createGmailOAuthHandler(
  deps: GmailOAuthDeps,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const id = correlationId(request);
    const log = deps.logger.child({ correlation_id: id });
    const clear = { "set-cookie": stateCookie("", 0), "x-correlation-id": id };

    if (request.method !== "GET") return text("Método não permitido.", 405, { allow: "GET" });
    const config = deps.config;
    if (config === null) {
      log.error("gmail_oauth.not_configured");
      return text("Integração com o Gmail não configurada.", 503);
    }
    const url = new URL(request.url);

    if (url.pathname.endsWith("/start")) {
      const state = randomToken();
      const pkce = await createPkce();
      log.info("gmail_oauth.started");
      return new Response(null, {
        status: 302,
        headers: {
          location: authorizationUrl(config.client, {
            state,
            challenge: pkce.challenge,
            loginHint: config.sender,
          }),
          "set-cookie": stateCookie(`${state}.${pkce.verifier}`, STATE_TTL_SECONDS),
          "cache-control": "no-store",
          "x-correlation-id": id,
        },
      });
    }

    if (!url.pathname.endsWith("/callback")) return text("Não encontrado.", 404);

    const saved = readCookie(request);
    const state = url.searchParams.get("state") ?? "";
    if (saved === null || !sameToken(state, saved.state)) {
      log.warn("gmail_oauth.state_mismatch");
      return text("Sessão de autorização inválida ou expirada. Inicie novamente.", 400, clear);
    }
    const denied = url.searchParams.get("error");
    if (denied !== null) {
      log.warn("gmail_oauth.denied", { reason: denied.slice(0, 40) });
      return text("Autorização não concedida.", 400, clear);
    }
    const code = url.searchParams.get("code");
    if (!code) return text("Código de autorização ausente.", 400, clear);

    const exchange = deps.exchange ??
      ((c: string, v: string) => exchangeCode(config.client, { code: c, verifier: v }));
    let granted: GrantedCredentials;
    try {
      granted = await exchange(code, saved.verifier);
    } catch (error) {
      log.error("gmail_oauth.exchange_failed", { error });
      return text("Não foi possível concluir a autorização. Inicie novamente.", 502, clear);
    }
    if (!granted.identity.emailVerified || granted.identity.email !== config.sender) {
      log.warn("gmail_oauth.unexpected_account");
      return text("Conta Google diferente da conta de envio configurada.", 403, clear);
    }

    try {
      const senderId = await deps.storeCredentials(
        config.storeId,
        config.sender,
        granted.refreshToken,
      );
      log.info("gmail_oauth.authorized", { sender_id: senderId });
    } catch (error) {
      log.error("gmail_oauth.store_failed", { error });
      return text("Falha ao salvar a autorização. Inicie novamente.", 503, clear);
    }
    return text("Gmail autorizado. Você pode fechar esta janela.", 200, clear);
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function configFromEnv(env: (name: string) => string | undefined): GmailOAuthConfig | null {
  const clientId = env("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = env("GOOGLE_OAUTH_CLIENT_SECRET");
  const redirectUri = env("GMAIL_OAUTH_REDIRECT_URI");
  const sender = env("GMAIL_SENDER")?.toLowerCase();
  const storeId = env("STORE_ID");
  if (!clientId || !clientSecret || !redirectUri?.startsWith("https://")) return null;
  if (!sender || !storeId || !UUID.test(storeId)) return null;
  return { client: { clientId, clientSecret, redirectUri }, sender, storeId };
}

export function defaultGmailOAuthHandler(): (request: Request) => Promise<Response> {
  const rpc = createRpc({
    url: Deno.env.get("SUPABASE_URL") ?? "",
    serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  });
  return createGmailOAuthHandler({
    config: configFromEnv((name) => Deno.env.get(name)),
    logger: createLogger({ service: "gmail-oauth" }),
    storeCredentials: (storeId, address, refreshToken) =>
      rpc<string>("store_email_credentials", {
        p_store_id: storeId,
        p_address: address,
        p_refresh_token: refreshToken,
      }),
  });
}
