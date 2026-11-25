# ADR 0010 — Canais de venda e fontes de produto liberados por métricas

Status: aceito · Data: 2026-11-28

## Contexto
- O Mercado Livre não aceita venda sem estoque com envio do exterior; o fornecedor precisa estar no Brasil, emitir nota e postar no prazo do Mercado Envios.
- Alibaba exige pedido mínimo e, para empresa, importação formal com CNPJ e Siscomex; a isenção do Remessa Conforme vale só para pessoa física.
- Amazon exige que o vendedor seja identificado no envio e proíbe atender pedidos comprando de outro varejista.
- Loja própria tem custo de venda menor, mas tráfego frio (conversão média de 1,65% no Brasil, contra 3% a 8% em marketplace) e depende de audiência própria ou mídia paga.
- Abrir canais antes da operação estável dilui atenção e expõe a reputação; abrir tarde deixa margem na mesa.

## Decisão
1. Mercado Livre com fornecedores nacionais é o canal único até as condições abaixo serem atendidas.
2. Preço de fábrica do Alibaba entra desde já como referência no motor de seleção; não é fonte de compra.
3. Cada expansão é liberada por portão de métricas calculado pelo Pulso e aprovado pela dona; nenhuma abertura por data.

| Expansão | Condições de liberação |
|---|---|
| Amazon (segundo canal) | CNPJ ativo; nível L2 atingido (30 vendas sem incidente); reclamações e cancelamentos ≤ 1% em 60 dias; ≥ 3 fornecedores aprovados com embalagem neutra e nota da loja; ≥ 5 produtos com margem de contribuição estressada ≥ 15% nas tarifas da Amazon |
| Loja própria | Instagram ativo; ≥ 300 visitas por mês sem mídia paga, medidas por 30 dias; ≥ 1 fornecedor que envie fora da etiqueta do Mercado Livre; teste de 60 dias com teto de mídia definido pela dona, mantido apenas se a margem por venda após custo de aquisição superar a do Mercado Livre |
| Importação via Alibaba para Full | CNPJ habilitado no Siscomex; produto com 90 dias de vendas estáveis; pedido mínimo coberto por até 60 dias de vendas; compra aprovada por `canFundPurchase` com a reserva de caixa; margem após tributos de importação ≥ margem nacional + 10 pontos |

4. O Pulso mede por canal e por produto: margem de contribuição, custo de aquisição, conversão, recompra, reputação, incidentes e giro. O portão é recalculado semanalmente e avisa quando todas as condições forem atendidas.
5. Dados de compradores do Mercado Livre não são usados para levar clientes a outros canais.

## Consequências
- Crescimento segue a capacidade operacional comprovada, não a expectativa.
- Novos canais exigem integrações próprias (Amazon SP-API, plataforma da loja, transportadora fora do Mercado Envios), planejadas só quando o portão abrir.
- Limiares podem ser revistos por novo ADR com base nos dados medidos.
