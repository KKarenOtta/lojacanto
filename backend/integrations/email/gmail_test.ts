import assert from "node:assert/strict";
import { AuthorizationError, UpstreamError } from "../../shared/errors.ts";
import { buildRawMessage, sendGmail } from "./gmail.ts";

const email = {
  from: "lojacantoutil@gmail.com",
  to: "comercial@fornecedor.test",
  subject: "Canto Útil: parceria",
  body: "Olá, equipe.\nAté breve.",
};

function decode(raw: string): string {
  const padded = raw.replace(/-/g, "+").replace(/_/g, "/");
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
}

Deno.test("mensagem bruta tem cabeçalhos corretos e corpo UTF-8", () => {
  const message = decode(buildRawMessage(email));
  assert.match(message, /^From: lojacantoutil@gmail\.com\r\nTo: comercial@fornecedor\.test\r\n/);
  assert.match(message, /Subject: =\?UTF-8\?B\?.+\?=/);
  const body = message.split("\r\n\r\n")[1]!.replace(/\r\n/g, "");
  assert.equal(
    new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0))),
    email.body,
  );
  assert.match(
    decode(buildRawMessage({ ...email, inReplyTo: "<abc@mail>" })),
    /In-Reply-To: <abc@mail>/,
  );
});

Deno.test("injeção de cabeçalho e endereços inválidos são recusados", () => {
  assert.throws(() => buildRawMessage({ ...email, subject: "x\r\nBcc: a@b.com" }), RangeError);
  assert.throws(() => buildRawMessage({ ...email, to: "a@b.com\r\nBcc: c@d.com" }), RangeError);
  assert.throws(() => buildRawMessage({ ...email, inReplyTo: "x\r\nBcc: y" }), RangeError);
});

Deno.test("envio devolve o id do Gmail e classifica erros", async () => {
  const requests: Request[] = [];
  const ok = await sendGmail({
    accessToken: () => Promise.resolve("token"),
    fetch: (input, init) => {
      requests.push(new Request(input, init));
      return Promise.resolve(new Response(JSON.stringify({ id: "18c1" })));
    },
  }, email);
  assert.equal(ok, "18c1");
  assert.equal(requests[0]!.headers.get("authorization"), "Bearer token");

  const respond = (status: number, body = "") => ({
    accessToken: () => Promise.resolve("token"),
    fetch: () => Promise.resolve(new Response(body, { status })),
  });
  await assert.rejects(sendGmail(respond(401), email), AuthorizationError);
  await assert.rejects(
    sendGmail(respond(429), email),
    (error: unknown) => error instanceof UpstreamError && error.retryable,
  );
  await assert.rejects(sendGmail(respond(200, "{}"), email), UpstreamError);
});
