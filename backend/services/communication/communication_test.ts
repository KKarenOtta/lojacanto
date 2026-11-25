import assert from "node:assert/strict";
import { decideSend, type SendContext } from "./policy.ts";
import { followUpEmail, isOptOut, prospectingEmail } from "./templates.ts";

const base: SendContext = {
  kind: "supplier_prospecting",
  level: "L1",
  approved: true,
  killSwitch: false,
  suppressed: false,
  replied: false,
  sentToday: 0,
  previousContacts: 0,
  lastContactAt: null,
  now: new Date("2026-12-10T12:00:00Z"),
};

Deno.test("prospecção aprovada é enviada uma vez por fornecedor dentro do limite diário", () => {
  assert.deepEqual(decideSend(base), { send: true });
  assert.deepEqual(decideSend({ ...base, previousContacts: 1 }), {
    send: false,
    reason: "already_contacted",
    retryable: false,
  });
  assert.deepEqual(decideSend({ ...base, sentToday: 10 }), {
    send: false,
    reason: "daily_limit",
    retryable: true,
  });
  assert.equal(
    (decideSend({ ...base, approved: false }) as { reason: string }).reason,
    "template_not_approved",
  );
});

Deno.test("bloqueios: kill switch, descadastro, resposta e limite de contatos", () => {
  assert.equal(
    (decideSend({ ...base, killSwitch: true }) as { reason: string }).reason,
    "kill_switch",
  );
  assert.equal(
    (decideSend({ ...base, suppressed: true }) as { reason: string }).reason,
    "suppressed",
  );
  assert.equal(
    (decideSend({ ...base, replied: true }) as { reason: string }).reason,
    "already_replied",
  );
  assert.equal(
    (decideSend({ ...base, kind: "supplier_follow_up", previousContacts: 2 }) as { reason: string })
      .reason,
    "contact_limit",
  );
});

Deno.test("lembrete só depois do intervalo mínimo e de um primeiro contato", () => {
  const followUp = { ...base, kind: "supplier_follow_up" as const, previousContacts: 1 };
  assert.equal(
    (decideSend({ ...followUp, lastContactAt: "2026-12-07T12:00:00Z" }) as { reason: string })
      .reason,
    "too_soon",
  );
  assert.deepEqual(decideSend({ ...followUp, lastContactAt: "2026-12-05T12:00:00Z" }), {
    send: true,
  });
  assert.equal(
    (decideSend({ ...base, kind: "supplier_follow_up" }) as { reason: string }).reason,
    "no_previous_contact",
  );
  assert.throws(() => decideSend({ ...followUp, lastContactAt: "ontem" }), RangeError);
});

Deno.test("pedido de compra exige aprovação no nível L1 e não no L2", () => {
  const order = { ...base, kind: "purchase_order" as const, approved: false };
  assert.equal((decideSend(order) as { reason: string }).reason, "approval_required");
  assert.deepEqual(decideSend({ ...order, level: "L2" }), { send: true });
  assert.deepEqual(decideSend({ ...order, approved: true }), { send: true });
});

const input = {
  supplierName: "Atacado Exemplo",
  categories: ["casa e organização", "papelaria"],
  senderName: "Karen",
  storeName: "Canto Útil",
  replyTo: "lojacantoutil@gmail.com",
};

Deno.test("e-mail de prospecção traz as perguntas de qualificação e a opção de descadastro", () => {
  const email = prospectingEmail(input);
  assert.equal(
    email.subject,
    "Canto Útil: parceria de dropshipping para casa e organização, papelaria",
  );
  for (
    const term of ["etiqueta do próprio Mercado Livre", "Inmetro", "devolução", "CNPJ", "remover"]
  ) {
    assert.ok(email.body.includes(term), term);
  }
  assert.ok(followUpEmail(input).subject.startsWith("Re: "));
});

Deno.test("campos do modelo são saneados e não podem ficar vazios", () => {
  const email = prospectingEmail({ ...input, supplierName: "Fornecedor\r\nBcc: x@y.com" });
  assert.ok(!email.body.includes("\r"));
  assert.ok(email.body.includes("Fornecedor Bcc: x@y.com"));
  assert.throws(() => prospectingEmail({ ...input, categories: [] }), RangeError);
  assert.throws(() => prospectingEmail({ ...input, senderName: " " }), RangeError);
});

Deno.test("resposta de descadastro é reconhecida", () => {
  assert.equal(isOptOut("Por favor, remover meu e-mail"), true);
  assert.equal(isOptOut("Não tenho interesse, obrigado"), true);
  assert.equal(isOptOut("Segue nosso catálogo"), false);
});
