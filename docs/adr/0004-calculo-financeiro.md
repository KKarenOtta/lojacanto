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
- Cada lançamento tem data de competência (data do pedido no fuso de São Paulo) e, quando houver movimento de dinheiro, data de caixa. O resultado usa competência; o caixa usa a data de liberação do Mercado Pago (`money_release_date`).
- DRE gerencial por período: receita bruta − devoluções − impostos sobre a venda = receita líquida; − custos variáveis (produto, frete do fornecedor, tarifa, frete do vendedor) = margem de contribuição; − despesas fixas cadastradas = resultado operacional. Ponto de equilíbrio = despesas fixas ÷ margem de contribuição percentual, arredondado para cima.
- Na devolução, o custo do produto permanece integral; recuperação junto ao fornecedor entra como lançamento próprio quando ocorrer.
- Capital de giro: o fornecedor é pago na venda e o dinheiro é liberado depois da entrega, então cada compra só é feita se a projeção de caixa, com as compras já comprometidas e as liberações previstas até a data, permanecer acima da reserva mínima.

## Consequências
- Mudanças de tarifa não alteram pedidos passados.
- Golden files com pedidos de referência protegem contra regressões.
- Imposto é parâmetro versionado por vigência; sem CNPJ, o campo fiscal permanece zero e o relatório indica a ausência de apuração.

## Referências (consultadas em 2026-11-24)
- Sebrae, Guia de planejamento financeiro para micro e pequenas empresas (ponto de equilíbrio e margem de contribuição): https://sebrae.com.br/Sebrae/Portal%20Sebrae/Arquivos/ebook_guia_de_planejamento_financeiro.pdf
- Sebrae, Gestão financeira: conheça o capital de giro (ciclo financeiro e NCG): https://sebrae.com.br/Sebrae/Portal%20Sebrae/Arquivos/ebook_gestao-financeira_conheca_capital_giro.pdf
- Mercado Pago, Relatório de Liberações: https://www.mercadopago.com.br/developers/pt/docs/reports/released-money/introduction
- https://developers.mercadolivre.com.br/pt_br/comissao-por-vender (atualizada em 2026-09-03)
