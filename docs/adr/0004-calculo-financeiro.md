# ADR 0004 — Dinheiro, snapshots e conciliação

Status: proposto · Data: 2026-11-24

## Contexto
- A comissão do Mercado Livre no MLB varia por categoria, tipo de anúncio, logística e outros fatores, e muda ao longo do tempo para o mesmo produto.
- A tarifa fixa só é calculada corretamente com `logistic_type` e `shipping_mode`.
- Recomendações de preço e escala dependem de margem confiável.

## Decisão
- Banco: valores em `numeric(14,2)` com `currency char(3)`; TypeScript: centavos em inteiro (`bigint` quando necessário). Proibido `float` para dinheiro.
- Cálculos de margem e contribuição implementados em `backend/services/finance` como funções puras, com testes de propriedade.
- Cada item de pedido recebe um snapshot imutável: custo do fornecedor, tarifa estimada (`/sites/MLB/listing_prices` com logística), frete, impostos parametrizados e versão dos parâmetros.
- `financial_entries` registra lançamentos estimados e realizados; a conciliação compara os dois e grava a divergência.
- Pedido sem custo essencial fica com margem `desconhecida` e não alimenta recomendações.
- Distinção explícita: faturamento, recebível, saldo disponível, contribuição estimada e lucro realizado.

## Consequências
- Mudanças de tarifa não alteram pedidos passados.
- Golden files com pedidos de referência protegem contra regressões.
- Imposto é parâmetro versionado por vigência; sem CNPJ, o campo fiscal permanece zero e o relatório indica a ausência de apuração.

## Referências (consultadas em 2026-11-24)
- https://developers.mercadolivre.com.br/pt_br/comissao-por-vender (atualizada em 2026-09-03)
