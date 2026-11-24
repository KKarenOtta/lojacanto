export class ContractError extends Error {
  override readonly name: string = "ContractError";
  constructor(readonly path: string, detail: string) {
    super(`${path}: ${detail}`);
  }
}

export class UpstreamError extends Error {
  override readonly name: string = "UpstreamError";
  constructor(readonly status: number, readonly retryable: boolean, message: string) {
    super(message);
  }
}

export class AuthorizationError extends UpstreamError {
  override readonly name: string = "AuthorizationError";
  constructor(message: string) {
    super(401, false, message);
  }
}
