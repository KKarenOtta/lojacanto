export interface PurchaseLine {
  supplierSku: string;
  description: string;
  quantity: number;
}

export interface PurchaseMessageInput {
  purchaseReference: string;
  supplierName: string;
  lines: PurchaseLine[];
  dispatchBy: string;
  labelAttached: boolean;
}

function clean(text: string, max: number): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max);
}

export function purchaseMessage(input: PurchaseMessageInput): string {
  if (input.lines.length === 0) throw new RangeError("purchase without lines");
  if (Number.isNaN(Date.parse(input.dispatchBy))) throw new RangeError("invalid dispatch date");
  for (const line of input.lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new RangeError("quantity must be a positive integer");
    }
  }
  const dispatchBy = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(input.dispatchBy));
  return [
    `Pedido ${clean(input.purchaseReference, 40)} — ${clean(input.supplierName, 80)}`,
    ...input.lines.map((line) =>
      `• ${line.quantity} × ${clean(line.supplierSku, 40)} — ${clean(line.description, 120)}`
    ),
    `Despachar até ${dispatchBy} (horário de Brasília).`,
    input.labelAttached
      ? "Etiqueta do Mercado Livre em anexo: usar somente ela, sem nota de preço nem material promocional."
      : "Etiqueta do Mercado Livre será enviada assim que liberada; aguardar antes de postar.",
    "Responda com a confirmação e o código de rastreio após a postagem.",
  ].join("\n");
}
