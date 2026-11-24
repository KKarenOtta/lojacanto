import { AuthorizationError, UpstreamError } from "../../shared/errors.ts";
import type { Logger } from "../../shared/log.ts";

export interface MercadoLivreClientDeps {
  baseUrl?: string;
  accessToken: () => Promise<string>;
  logger: Logger;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
  timeoutMs?: number;
}

export interface MercadoLivreClient {
  get(path: string, headers?: Record<string, string>): Promise<unknown>;
  post(path: string, body?: unknown): Promise<unknown>;
}

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

export function backoffDelay(attempt: number, random: () => number): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
  return Math.floor(random() * ceiling);
}

export function createMercadoLivreClient(deps: MercadoLivreClientDeps): MercadoLivreClient {
  const baseUrl = deps.baseUrl ?? "https://api.mercadolibre.com";
  const doFetch = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const random = deps.random ?? Math.random;
  const maxAttempts = deps.maxAttempts ?? 4;
  const timeoutMs = deps.timeoutMs ?? 10_000;

  async function attempt(
    method: "GET" | "POST",
    path: string,
    headers: Record<string, string>,
    body?: unknown,
  ): Promise<unknown> {
    const started = performance.now();
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
          authorization: `Bearer ${await deps.accessToken()}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new UpstreamError(0, true, `network error: ${(error as Error).name}`);
    }
    deps.logger.debug("mercadolivre.request", {
      method,
      path,
      status: response.status,
      duration_ms: Math.round(performance.now() - started),
    });
    if (response.ok) {
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    }
    await response.body?.cancel();
    if (response.status === 401) throw new AuthorizationError(`unauthorized on ${path}`);
    const retryable = response.status === 429 || response.status >= 500;
    throw new UpstreamError(response.status, retryable, `HTTP ${response.status} on ${path}`);
  }

  function checkPath(path: string): void {
    if (!path.startsWith("/") || path.includes("://")) throw new RangeError("invalid path");
  }

  return {
    async post(path, body) {
      checkPath(path);
      for (let tries = 1;; tries++) {
        try {
          return await attempt("POST", path, {}, body);
        } catch (error) {
          const throttled = error instanceof UpstreamError && error.status === 429;
          if (!throttled || tries >= maxAttempts) throw error;
          await sleep(backoffDelay(tries, random));
        }
      }
    },
    async get(path, headers = {}) {
      checkPath(path);
      for (let tries = 1;; tries++) {
        try {
          return await attempt("GET", path, headers);
        } catch (error) {
          const retry = error instanceof UpstreamError && error.retryable && tries < maxAttempts;
          if (!retry) throw error;
          const delay = backoffDelay(tries, random);
          deps.logger.warn("mercadolivre.retry", {
            path,
            status: (error as UpstreamError).status,
            attempt: tries,
            delay_ms: delay,
          });
          await sleep(delay);
        }
      }
    },
  };
}
