export interface ProspectingInput {
  supplierName: string;
  categories: string[];
  senderName: string;
  storeName: string;
  replyTo: string;
}

export interface EmailContent {
  subject: string;
  body: string;
}

const OPT_OUT =
  'Se não quiser receber novos contatos, responda com "remover" e não escreveremos mais.';

function clean(value: string, max: number): string {
  const text = value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (text.length === 0) throw new RangeError("empty template field");
  return text.slice(0, max);
}

const QUESTIONS = [
  "1. Vocês trabalham com dropshipping (envio direto ao cliente) para vendedores do Mercado Livre?",
  "2. Aceitam postar com a etiqueta do próprio Mercado Livre, em embalagem neutra, sem material promocional?",
  "3. Qual o prazo entre a confirmação do pedido e a postagem?",
  "4. Como informam estoque e preços (planilha, catálogo online, API)?",
  "5. Exigem CNPJ? Há mensalidade, pedido mínimo ou taxa por pedido?",
  "6. Qual a política para defeito, troca e devolução?",
  "7. Os artigos escolares do catálogo têm certificação Inmetro e selo na embalagem original?",
];

export function prospectingEmail(input: ProspectingInput): EmailContent {
  const supplier = clean(input.supplierName, 80);
  const categories = input.categories.map((category) => clean(category, 40));
  if (categories.length === 0) throw new RangeError("categories required");
  const store = clean(input.storeName, 60);
  return {
    subject: `${store}: parceria de dropshipping para ${categories.join(", ")}`,
    body: [
      `Olá, equipe ${supplier}.`,
      "",
      `Sou ${
        clean(input.senderName, 60)
      }, da ${store}, loja que vende no Mercado Livre nas categorias ${
        categories.join(", ")
      }. Procuramos fornecedores nacionais para operar sem estoque próprio, com envio direto ao comprador.`,
      "",
      "Poderiam nos informar:",
      ...QUESTIONS,
      "",
      `Se fizer sentido, enviem o catálogo com custos para ${clean(input.replyTo, 120)}.`,
      "",
      "Obrigada,",
      clean(input.senderName, 60),
      store,
      "",
      OPT_OUT,
    ].join("\n"),
  };
}

export function followUpEmail(input: ProspectingInput): EmailContent {
  const first = prospectingEmail(input);
  return {
    subject: `Re: ${first.subject}`,
    body: [
      `Olá, equipe ${clean(input.supplierName, 80)}.`,
      "",
      "Retomo o contato sobre a parceria de dropshipping. Se tiverem interesse, basta responder este e-mail com o catálogo e as condições.",
      "",
      "Obrigada,",
      clean(input.senderName, 60),
      clean(input.storeName, 60),
      "",
      OPT_OUT,
    ].join("\n"),
  };
}

export function isOptOut(reply: string): boolean {
  return /\b(remover|descadastrar|n[aã]o tenho interesse|unsubscribe)\b/i.test(reply);
}
