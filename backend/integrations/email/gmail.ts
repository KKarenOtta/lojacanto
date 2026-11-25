import { AuthorizationError, UpstreamError } from "../../shared/errors.ts";

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
}

const ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(value)))}?=`;
}

export function buildRawMessage(email: OutgoingEmail): string {
  for (const address of [email.from, email.to]) {
    if (!ADDRESS.test(address)) throw new RangeError("invalid email address");
  }
  if (/[\r\n]/.test(email.subject)) throw new RangeError("invalid subject");
  if (email.inReplyTo !== undefined && !/^<[^<>\s]+>$/.test(email.inReplyTo)) {
    throw new RangeError("invalid In-Reply-To");
  }
  const headers = [
    `From: ${email.from}`,
    `To: ${email.to}`,
    `Subject: ${encodeHeader(email.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    ...(email.inReplyTo
      ? [`In-Reply-To: ${email.inReplyTo}`, `References: ${email.inReplyTo}`]
      : []),
  ];
  const body = btoa(String.fromCharCode(...new TextEncoder().encode(email.body)))
    .replace(/(.{76})/g, "$1\r\n");
  return base64url(new TextEncoder().encode(`${headers.join("\r\n")}\r\n\r\n${body}`));
}

export interface GmailDeps {
  accessToken: () => Promise<string>;
  fetch?: typeof fetch;
}

export async function sendGmail(deps: GmailDeps, email: OutgoingEmail): Promise<string> {
  const raw = buildRawMessage(email);
  const response = await (deps.fetch ?? fetch)(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await deps.accessToken()}`,
      },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status === 401) {
    await response.body?.cancel();
    throw new AuthorizationError("gmail unauthorized");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new UpstreamError(
      response.status,
      response.status === 429,
      `gmail HTTP ${response.status}`,
    );
  }
  const id = (await response.json() as { id?: unknown }).id;
  if (typeof id !== "string") throw new UpstreamError(502, false, "gmail response without id");
  return id;
}
