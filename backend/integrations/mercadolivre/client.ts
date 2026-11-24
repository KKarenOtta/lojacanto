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

  async function attempt(path: string, headers: Record<string, string>): Promise<unknown> {
    const started = performance.now();
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        headers: {
          accept: "application/json",
          ...headers,
          authorization: `Bearer ${await deps.accessToken()}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new UpstreamError(0, true, `network error: ${(error as Error).name}`);
    }
    deps.logger.debug("mercadolivre.request", {
      path,
      status: response.status,
      duration_ms: Math.round(performance.now() - started),
    });
    if (response.ok) return await response.json();
    await response.body?.cancel();
    if (response.status === 401) throw new AuthorizationError(`unauthorized on ${path}`);
    const retryable = response.status === 429 || response.status >= 500;
    throw new UpstreamError(response.status, retryable, `HTTP ${response.status} on ${path}`);
  }

  return {
    async get(path, headers = {}) {
      if (!path.startsWith("/") || path.includes("://")) throw new RangeError("invalid path");
      for (let tries = 1;; tries++) {
        try {
          return await attempt(path, headers);
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
