export interface TitleInput {
  product: string;
  brand?: string;
  model?: string;
  features: string[];
}

export type TitleRejection = "condition_term" | "stock_term";

export interface TitleResult {
  title: string;
  dropped: string[];
}

const CONDITION_TERMS = [
  "novo",
  "nova",
  "novos",
  "novas",
  "usado",
  "usada",
  "seminovo",
  "seminova",
  "recondicionado",
  "recondicionada",
];
const STOCK_TERMS = ["estoque", "pronta entrega", "ultimas unidades", "ultima unidade"];

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function normalizeTitlePart(value: string): string {
  return value
    .replace(/[^\p{L}\p{N}.,]+/gu, " ")
    .replace(/(?<!\d)[.,]|[.,](?!\d)/g, " ")
    .replace(/(?<=\d)\.(?=\d)/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleRejections(input: TitleInput): TitleRejection[] {
  const text = ` ${
    fold(
      normalizeTitlePart(
        [input.product, input.brand ?? "", input.model ?? "", ...input.features].join(" "),
      ),
    )
  } `;
  const rejections: TitleRejection[] = [];
  if (CONDITION_TERMS.some((term) => text.includes(` ${term} `))) rejections.push("condition_term");
  if (STOCK_TERMS.some((term) => text.includes(` ${term} `))) rejections.push("stock_term");
  return rejections;
}

export function buildTitle(input: TitleInput, maxLength: number): TitleResult {
  if (!Number.isInteger(maxLength) || maxLength <= 0) {
    throw new RangeError("maxLength must be a positive integer");
  }
  const rejections = titleRejections(input);
  if (rejections.length > 0) throw new RangeError(`title rejected: ${rejections.join(", ")}`);

  const product = normalizeTitlePart(input.product);
  if (product.length === 0) throw new RangeError("product is required");
  if (product.length > maxLength) throw new RangeError("product longer than maxLength");

  let title = product;
  const dropped: string[] = [];
  for (const raw of [input.brand, input.model, ...input.features]) {
    if (raw === undefined) continue;
    const part = normalizeTitlePart(raw);
    if (part.length === 0 || fold(` ${title} `).includes(` ${fold(part)} `)) continue;
    const candidate = `${title} ${part}`;
    if (candidate.length <= maxLength) title = candidate;
    else dropped.push(part);
  }
  return { title, dropped };
}
