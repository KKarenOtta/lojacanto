export interface DescriptionInput {
  summary: string;
  highlights: string[];
  includedItems: string[];
  usage: string[];
  care: string[];
}

export type DescriptionRejection = "markup" | "emoji" | "contact_data" | "empty_summary";

const MARKUP = /[<>]/;
const EMOJI = /\p{Extended_Pictographic}/u;
const PHONE = /\d{10,}/;
const CONTACT = [
  /[\w.+-]+@[\w-]+\.[\w.]+/,
  /\b(?:https?:\/\/|www\.)/i,
  /\b[\w-]+\.(?:com|net|org)(?:\.br)?\b/i,
  /\bwhats\s?app\b/i,
];

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function fields(input: DescriptionInput): string[] {
  return [
    input.summary,
    ...input.highlights,
    ...input.includedItems,
    ...input.usage,
    ...input.care,
  ];
}

export function descriptionRejections(input: DescriptionInput): DescriptionRejection[] {
  const rejections = new Set<DescriptionRejection>();
  if (clean(input.summary).length === 0) rejections.add("empty_summary");
  for (const field of fields(input)) {
    if (MARKUP.test(field)) rejections.add("markup");
    if (EMOJI.test(field)) rejections.add("emoji");
    const digits = field.replace(/[\s().+-]/g, "");
    if (CONTACT.some((pattern) => pattern.test(field)) || PHONE.test(digits)) {
      rejections.add("contact_data");
    }
  }
  return [...rejections];
}

function section(heading: string, items: string[]): string[] {
  const lines = items.map(clean).filter((item) => item.length > 0);
  return lines.length === 0 ? [] : ["", heading, ...lines.map((item) => `- ${item}`)];
}

export function buildDescription(input: DescriptionInput): string {
  const rejections = descriptionRejections(input);
  if (rejections.length > 0) throw new RangeError(`description rejected: ${rejections.join(", ")}`);
  return [
    clean(input.summary),
    ...section("DESTAQUES", input.highlights),
    ...section("O QUE VEM NA EMBALAGEM", input.includedItems),
    ...section("COMO USAR", input.usage),
    ...section("CUIDADOS", input.care),
    "",
    "Ficou com alguma dúvida? Pergunte no anúncio que respondemos rapidinho.",
  ].join("\n");
}
