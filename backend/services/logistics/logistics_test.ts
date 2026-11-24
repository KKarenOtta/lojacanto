import assert from "node:assert/strict";
import { dceDeadline, deadlineLevel } from "./deadlines.ts";
import { MINIMUM_SAMPLE, scoreSupplier } from "./supplier_score.ts";

const policy = { warningHours: 12, criticalHours: 4 };
const now = new Date("2026-12-01T12:00:00Z");

Deno.test("nível do prazo cobre todos os cenários antes e depois do vencimento", () => {
  assert.equal(deadlineLevel("2026-12-02T12:00:00Z", now, policy), "ok");
  assert.equal(deadlineLevel("2026-12-01T23:59:59Z", now, policy), "warning");
  assert.equal(deadlineLevel("2026-12-02T00:00:00Z", now, policy), "warning");
  assert.equal(deadlineLevel("2026-12-01T16:00:00Z", now, policy), "critical");
  assert.equal(deadlineLevel("2026-12-01T12:00:01Z", now, policy), "critical");
  assert.equal(deadlineLevel("2026-12-01T12:00:00Z", now, policy), "overdue");
  assert.equal(deadlineLevel("2026-11-30T12:00:00Z", now, policy), "overdue");
});

Deno.test("alerta é emitido antes do prazo em todo instante da janela de aviso", () => {
  const deadline = new Date("2026-12-02T00:00:00Z");
  for (let minutes = 1; minutes <= policy.warningHours * 60; minutes += 7) {
    const at = new Date(deadline.getTime() - minutes * 60_000);
    assert.notEqual(
      deadlineLevel(deadline.toISOString(), at, policy),
      "ok",
      `${minutes} min antes`,
    );
  }
});

Deno.test("política e datas inválidas são recusadas", () => {
  const due = "2026-12-02T00:00:00Z";
  assert.throws(() => deadlineLevel(due, now, { warningHours: 4, criticalHours: 4 }), RangeError);
  assert.throws(() => deadlineLevel(due, now, { warningHours: 4, criticalHours: 0 }), RangeError);
  assert.throws(() => deadlineLevel("amanhã", now, policy), RangeError);
  assert.throws(() => dceDeadline("ontem"), RangeError);
});

Deno.test("DC-e vence 3 dias corridos após a venda", () => {
  assert.equal(dceDeadline("2026-12-01T10:00:00-03:00"), "2026-12-04T13:00:00.000Z");
});

Deno.test("score de fornecedor exige amostra mínima e expõe a incerteza", () => {
  const small = scoreSupplier({ orders: 5, onTime: 5, defects: 0, cancellations: 0 });
  assert.equal(small.sufficientSample, false);
  assert.equal(small.scoreBps, null);
  assert.ok(small.onTimeLowerBps < 6_000);

  const reliable = scoreSupplier({ orders: 100, onTime: 97, defects: 1, cancellations: 0 });
  const weak = scoreSupplier({ orders: 100, onTime: 80, defects: 5, cancellations: 3 });
  assert.equal(reliable.sufficientSample, true);
  assert.ok(reliable.scoreBps! > weak.scoreBps!);
  assert.ok(reliable.onTimeLowerBps < 9_700);

  const borderline = scoreSupplier({
    orders: MINIMUM_SAMPLE,
    onTime: MINIMUM_SAMPLE,
    defects: 0,
    cancellations: 0,
  });
  assert.equal(borderline.sufficientSample, true);
  assert.equal(
    scoreSupplier({ orders: 0, onTime: 0, defects: 0, cancellations: 0 }).onTimeLowerBps,
    0,
  );
});

Deno.test("contagens inconsistentes são recusadas", () => {
  assert.throws(
    () => scoreSupplier({ orders: 10, onTime: 11, defects: 0, cancellations: 0 }),
    RangeError,
  );
  assert.throws(
    () => scoreSupplier({ orders: 10, onTime: 5, defects: 6, cancellations: 5 }),
    RangeError,
  );
  assert.throws(
    () => scoreSupplier({ orders: -1, onTime: 0, defects: 0, cancellations: 0 }),
    RangeError,
  );
});
