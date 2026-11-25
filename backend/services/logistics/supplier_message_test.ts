import assert from "node:assert/strict";
import { purchaseMessage } from "./supplier_message.ts";

const input = {
  purchaseReference: "PC-0001",
  supplierName: "Fornecedor P",
  lines: [{ supplierSku: "ORG-12", description: "Organizador de gaveta", quantity: 2 }],
  dispatchBy: "2026-12-02T20:00:00Z",
  labelAttached: true,
};

Deno.test("mensagem ao fornecedor traz itens, prazo em Brasília e instrução da etiqueta", () => {
  assert.equal(
    purchaseMessage(input),
    [
      "Pedido PC-0001 — Fornecedor P",
      "• 2 × ORG-12 — Organizador de gaveta",
      "Despachar até 02/12/2026, 17:00 (horário de Brasília).",
      "Etiqueta do Mercado Livre em anexo: usar somente ela, sem nota de preço nem material promocional.",
      "Responda com a confirmação e o código de rastreio após a postagem.",
    ].join("\n"),
  );
});

Deno.test("mensagem não leva dados do comprador e neutraliza quebras de linha", () => {
  const text = purchaseMessage({
    ...input,
    labelAttached: false,
    lines: [{ supplierSku: "X\nY", description: "linha 1\r\nlinha 2", quantity: 1 }],
  });
  assert.match(text, /• 1 × X Y — linha 1 linha 2/);
  assert.match(text, /aguardar antes de postar/);
});

Deno.test("mensagem sem itens, com quantidade ou data inválida é recusada", () => {
  assert.throws(() => purchaseMessage({ ...input, lines: [] }), RangeError);
  assert.throws(() => purchaseMessage({ ...input, dispatchBy: "amanhã" }), RangeError);
  assert.throws(
    () => purchaseMessage({ ...input, lines: [{ ...input.lines[0]!, quantity: 0 }] }),
    RangeError,
  );
});
