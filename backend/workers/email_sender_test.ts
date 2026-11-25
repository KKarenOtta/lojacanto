import assert from "node:assert/strict";
import type { Alert } from "../integrations/telegram/alerts.ts";
import { AuthorizationError, UpstreamError } from "../shared/errors.ts";
import { createLogger } from "../shared/log.ts";
import {
  type ClaimedMessage,
  type EmailSenderDeps,
  type Outcome,
  sendOutboundMessages,
} from "./email_sender.ts";

const now = new Date("2026-11-28T12:00:00Z");

function message(id: string, sender = "s1"): ClaimedMessage {
  return {
    id,
    store_id: "store",
    sender_id: sender,
    sender_address: "lojacantoutil@gmail.com",
    recipient: `${id}@fornecedor.test`,
    subject: "Canto Útil: parceria",
    body: "Olá",
    in_reply_to: null,
    attempts: 1,
  };
}

function setup(messages: ClaimedMessage[], send: EmailSenderDeps["send"]) {
  const completed: [string, Outcome, string | undefined][] = [];
  const alerts: Alert[] = [];
  const marked: string[] = [];
  let refreshes = 0;
  const deps: EmailSenderDeps = {
    claim: () => Promise.resolve(messages),
    refreshToken: () => Promise.resolve("refresh"),
    accessToken: () => {
      refreshes++;
      return Promise.resolve({ token: "access", expiresAt: new Date(now.getTime() + 3_600_000) });
    },
    send,
    complete: (id, outcome, providerId) => {
      completed.push([id, outcome, providerId]);
      return Promise.resolve();
    },
    markReauthorization: (id) => {
      marked.push(id);
      return Promise.resolve();
    },
    alerts: {
      send: (alert) => {
        alerts.push(alert);
        return Promise.resolve(true);
      },
    },
    logger: createLogger({}, () => {}),
    now: () => now,
  };
  return { deps, completed, alerts, marked, refreshes: () => refreshes };
}

Deno.test("envia o lote reaproveitando o token de acesso", async () => {
  const sent: string[] = [];
  const { deps, completed, refreshes } = setup(
    [message("a"), { ...message("b"), in_reply_to: "<x@mail>" }],
    (_token, email) => {
      sent.push(`${email.to}|${email.inReplyTo ?? ""}`);
      return Promise.resolve(`gmail-${sent.length}`);
    },
  );
  const summary = await sendOutboundMessages(deps);
  assert.deepEqual(summary, { sent: 2, retried: 0, failed: 0, reauthorization: 0 });
  assert.deepEqual(sent, ["a@fornecedor.test|", "b@fornecedor.test|<x@mail>"]);
  assert.deepEqual(completed, [["a", "sent", "gmail-1"], ["b", "sent", "gmail-2"]]);
  assert.equal(refreshes(), 1);
});

Deno.test("autorização revogada pausa o remetente e alerta uma vez", async () => {
  const { deps, completed, alerts, marked } = setup(
    [message("a"), message("b"), message("c", "s2")],
    (_token, email) =>
      email.to.startsWith("c")
        ? Promise.resolve("ok")
        : Promise.reject(new AuthorizationError("gmail unauthorized")),
  );
  const summary = await sendOutboundMessages(deps);
  assert.deepEqual(summary, { sent: 1, retried: 2, failed: 0, reauthorization: 1 });
  assert.deepEqual(marked, ["s1"]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.severity, "critical");
  assert.deepEqual(completed.map(([id, outcome]) => `${id}:${outcome}`), [
    "a:retry",
    "b:retry",
    "c:sent",
  ]);
});

Deno.test("remetente sem credencial ativa é tratado como reautorização", async () => {
  const { deps, marked } = setup([message("a")], () => Promise.resolve("x"));
  deps.refreshToken = () => Promise.resolve(null);
  const summary = await sendOutboundMessages(deps);
  assert.equal(summary.reauthorization, 1);
  assert.deepEqual(marked, ["s1"]);
});

Deno.test("falha temporária volta à fila e falha definitiva encerra", async () => {
  const { deps, completed } = setup(
    [message("a"), message("b")],
    (_token, email) =>
      Promise.reject(
        email.to.startsWith("a")
          ? new UpstreamError(429, true, "gmail HTTP 429")
          : new RangeError("invalid email address"),
      ),
  );
  const summary = await sendOutboundMessages(deps);
  assert.deepEqual(summary, { sent: 0, retried: 1, failed: 1, reauthorization: 0 });
  assert.deepEqual(completed.map(([id, outcome]) => `${id}:${outcome}`), ["a:retry", "b:failed"]);
});

Deno.test("token perto de expirar é renovado", async () => {
  const { deps } = setup([message("a"), message("b")], () => Promise.resolve("x"));
  let calls = 0;
  deps.accessToken = () => {
    calls++;
    return Promise.resolve({ token: "t", expiresAt: new Date(now.getTime() + 30_000) });
  };
  await sendOutboundMessages(deps);
  assert.equal(calls, 2);
});
