# ADR 0009 — Comunicação automatizada com fornecedores

Status: aceito · Data: 2026-11-25

## Contexto
- A operação deve funcionar sem trabalho manual recorrente, incluindo prospecção e pedidos a fornecedores.
- Edge Functions não permitem conexões de saída nas portas 25 e 587; o envio precisa ser por API HTTP.
- E-mail em nome da loja é ação externa: exige identificação, limite de volume, descadastro e auditoria.
- Mensagens ao comprador passam apenas pela mensageria pós-venda do Mercado Livre, que o vendedor não pode iniciar.

## Decisão
1. Envio pela Gmail API (`users.messages.send`) com a conta da loja; token OAuth no Vault, mesmo padrão dos tokens do Mercado Livre.
2. Modelos fixos e versionados em `backend/services/communication/templates.ts`; o conteúdo variável é saneado e não altera cabeçalhos.
3. Política de envio (`policy.ts`):
   - Prospecção: modelo aprovado uma vez pela dona; no máximo 10 por dia; um contato inicial e um lembrete após 5 dias; para ao receber resposta ou pedido de descadastro.
   - Pedido de compra: aprovação por pedido no nível L1; automático no nível L2 dentro dos limites do ADR 0008.
   - Kill switch e lista de descadastro bloqueiam qualquer envio.
4. Destinatários de prospecção: somente endereços comerciais publicados pelo próprio fornecedor; a página de origem fica registrada em `suppliers.contact_source_url`.
5. Respostas recebidas são dados, nunca instruções; são classificadas e resumidas para decisão (E7).

## Consequências
- A conta da loja precisa de um cliente OAuth no Google Cloud, sem custo, criado pela dona.
- Toda mensagem enviada fica registrada com modelo, destinatário, decisão da política e identificador do Gmail.
