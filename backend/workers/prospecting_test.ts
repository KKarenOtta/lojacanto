import assert from "node:assert/strict";
import { createLogger } from "../shared/log.ts";
import {
  type PlannedMessage,
  planProspecting,
  type ProspectCandidate,
  type ProspectingContext,
  type ProspectingDeps,
  TEMPLATES,
} from "./prospecting.ts";

const now = new Date("2026-12-01T13:00:00Z");

function candidate(id: string, overrides: Partial<ProspectCandidate> = {}): ProspectCandidate {
  return {
    supplier_id: id,
    name: `Fornecedor ${id}`,
    contact_email: `${id}@fornecedor.test`,
    categories: ["casa", "cozinha"],
    prospect_stage: "candidate",
    suppressed: false,
    previous_contacts: 0,
    last_contact_at: null,
    pending: false,
    ...overrides,
  };
}

const context: ProspectingContext = {
  sender_id: "sender-1",
  sender_address: "lojacantoutil@gmail.com",
  approved_templates: [TEMPLATES.supplier_prospecting, TEMPLATES.supplier_follow_up],
  prospecting_today: 0,
};

function setup(candidates: ProspectCandidate[], overrides: Partial<ProspectingDeps> = {}) {
  const planned: PlannedMessage[] = [];
  const stages: string[] = [];
  const deps: ProspectingDeps = {
    storeId: "store",
    storeName: "Canto Útil",
    senderName: "Karen",
    level: "L1",
    killSwitchActive: () => Promise.resolve(false),
    context: () => Promise.resolve(context),
    candidates: () => Promise.resolve(candidates),
    enqueue: (_store, message) => {
      planned.push(message);
      return Promise.resolve(`msg-${planned.length}`);
    },
    setStage: (id) => {
      stages.push(id);
      return Promise.resolve();
    },
    logger: createLogger({}, () => {}),
    now: () => now,
    ...overrides,
  };
  return { deps, planned, stages };
}

Deno.test("primeiro contato usa o modelo de prospecção e marca o fornecedor", async () => {
  const { deps, planned, stages } = setup([candidate("a")]);
  const summary = await planProspecting(deps);
  assert.equal(summary.planned, 1);
  assert.equal(planned[0]!.template, TEMPLATES.supplier_prospecting);
  assert.equal(planned[0]!.recipient, "a@fornecedor.test");
  assert.match(planned[0]!.content.body, /responda com "remover"/);
  assert.deepEqual(stages, ["a"]);
});

Deno.test("lembrete só após o intervalo e no máximo dois contatos", async () => {
  const { deps, planned, stages } = setup([
    candidate("cedo", {
      prospect_stage: "contacted",
      previous_contacts: 1,
      last_contact_at: "2026-11-29T13:00:00Z",
    }),
    candidate("pronto", {
      prospect_stage: "contacted",
      previous_contacts: 1,
      last_contact_at: "2026-11-25T13:00:00Z",
    }),
    candidate("esgotado", {
      prospect_stage: "contacted",
      previous_contacts: 2,
      last_contact_at: "2026-11-20T13:00:00Z",
    }),
  ]);
  const summary = await planProspecting(deps);
  assert.deepEqual(planned.map((m) => `${m.supplierId}:${m.kind}`), [
    "pronto:supplier_follow_up",
  ]);
  assert.match(planned[0]!.content.subject, /^Re: /);
  assert.deepEqual(summary.skipped, { too_soon: 1, contact_limit: 1 });
  assert.deepEqual(stages, []);
});

Deno.test("limite diário considera o que já foi planejado no dia", async () => {
  const { deps, planned } = setup(
    Array.from({ length: 5 }, (_, i) => candidate(`f${i}`)),
    { context: () => Promise.resolve({ ...context, prospecting_today: 8 }) },
  );
  const summary = await planProspecting(deps);
  assert.equal(planned.length, 2);
  assert.equal(summary.skipped.daily_limit, 3);
});

Deno.test("descadastro, pendência e modelo não aprovado bloqueiam", async () => {
  const { deps, planned } = setup(
    [candidate("s", { suppressed: true }), candidate("p", { pending: true }), candidate("n")],
    {
      context: () =>
        Promise.resolve({ ...context, approved_templates: [TEMPLATES.supplier_follow_up] }),
    },
  );
  const summary = await planProspecting(deps);
  assert.equal(planned.length, 0);
  assert.deepEqual(summary.skipped, { suppressed: 1, pending: 1, template_not_approved: 1 });
});

Deno.test("kill switch e ausência de remetente interrompem", async () => {
  let { deps } = setup([candidate("a")], { killSwitchActive: () => Promise.resolve(true) });
  assert.equal((await planProspecting(deps)).halted, "kill_switch");
  ({ deps } = setup([candidate("a")], { context: () => Promise.resolve(null) }));
  assert.equal((await planProspecting(deps)).halted, "no_sender");
});

Deno.test("falha ao enfileirar não altera o estágio nem consome o limite", async () => {
  let calls = 0;
  const { deps, stages } = setup([candidate("a"), candidate("b")], {
    enqueue: () => (++calls === 1 ? Promise.reject(new Error("db")) : Promise.resolve("ok")),
  });
  const summary = await planProspecting(deps);
  assert.equal(summary.planned, 1);
  assert.equal(summary.skipped.enqueue_failed, 1);
  assert.deepEqual(stages, ["b"]);
});
