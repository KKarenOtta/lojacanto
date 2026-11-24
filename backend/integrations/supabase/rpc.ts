import { UpstreamError } from "../../shared/errors.ts";

export interface RpcConfig {
  url: string;
  serviceKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export type Rpc = <T>(fn: string, args: Record<string, unknown>) => Promise<T>;

export function createRpc(config: RpcConfig): Rpc {
  const doFetch = config.fetch ?? fetch;
  const base = config.url.replace(/\/+$/, "");
  return async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    if (!/^[a-z_]+$/.test(fn)) throw new RangeError("invalid function name");
    let response: Response;
    try {
      response = await doFetch(`${base}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: config.serviceKey,
          authorization: `Bearer ${config.serviceKey}`,
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(config.timeoutMs ?? 5_000),
      });
    } catch (error) {
      throw new UpstreamError(0, true, `database unreachable: ${(error as Error).name}`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new UpstreamError(response.status, response.status >= 500, `rpc ${fn} failed`);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : null) as T;
  };
}
