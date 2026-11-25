# ADR 0008 — Seleção automatizada de produtos e fornecedores com autonomia progressiva

Status: aceito · Data: 2026-11-24

## Contexto
- O objetivo é operar sem trabalho manual recorrente: o sistema escolhe produtos e fornecedores, anuncia, compra e acompanha.
- Fontes oficiais disponíveis: `/highlights/MLB/category/{id}` (20 mais vendidos por categoria folha, só posição), `/trends/MLB[/{category}]` (50 termos semanais), visitas por item, `listing_prices` e custos de envio.
- Venda sem estoque próprio exige fornecedor nacional, despacho rápido e informação correta no anúncio; a reputação do vendedor responde por atrasos e devoluções.
- Anunciar, alterar preço, trocar fornecedor e comprar são ações de alto impacto.

## Decisão
1. Pipeline semanal: descoberta → filtros eliminatórios → viabilidade financeira com cenário de estresse → qualificação de fornecedor → anúncio → acompanhamento → reavaliação.
2. Filtros eliminatórios de produto: categoria restrita ou regulada sem certificação comprovada (Anvisa, Inmetro, Anatel), marca de terceiros sem autorização, peso ou dimensões acima do limite operacional, fragilidade, prazo do fornecedor acima do SLA.
2a. Artigos escolares da Portaria Inmetro nº 423/2021 (24 itens, entre eles lápis, canetas, borracha, cola, tesoura, estojo, régua, lancheira e tintas) só entram com certificação, selo e embalagem original preservados, inclusive na foto do anúncio. Kits seguem a regra de cada item; kit montado por terceiro só entra se o fornecedor que monta atender ao Anexo B do RGCP (Portaria Inmetro nº 200/2021). Cadernos, livros e quadros não estão no escopo da certificação.
3. Pontuação de produto: margem de contribuição após estresse (devolução, aumento de custo, comissão maior), demanda persistente em semanas consecutivas ou dentro da janela sazonal do produto, concorrência no catálogo, taxa de devolução esperada da categoria, faixa de preço em relação ao limite de frete grátis.
4. Fornecedor elegível: CNPJ ativo e compatível, nota fiscal da compra, aceite da etiqueta do Mercado Livre, embalagem neutra, estoque informado com frequência definida, política de devolução, pedido-teste aprovado. Fornecedor de plataforma dispensa o pedido-teste pago: as primeiras vendas reais funcionam como teste, com acompanhamento de cada etapa pelo Pulso. Todo produto ativo tem fornecedor alternativo ou fica limitado em volume.
5. Autonomia progressiva:
   - L1 até 30 vendas sem incidente: o sistema executa todo o preparo e cada anúncio, preço, fornecedor e compra aguarda aprovação.
   - L2 depois disso: execução automática dentro de limites registrados (faixa de preço, margem mínima, quantidade de anúncios, valor de compra), com auditoria e kill switch; fora dos limites volta para aprovação.
   - Compras e criação de contas em fornecedores com custo sempre exigem aprovação.
6. O motor de seleção é desenvolvido em paralelo à E4 por ser somente leitura; publica apenas recomendações até a E8.
7. Fornecedor de plataforma (canal `platform`, como a Silkdrop): a plataforma importa o pedido pela integração dela com o Mercado Livre e o pagamento é feito pela dona no painel da plataforma. O Pulso não envia pedido de compra; registra a ordem como tarefa da dona com o próximo horário de corte do fornecedor e acompanha a postagem pelo envio do Mercado Livre. A plataforma também zera o estoque dos anúncios quando o fornecedor esgota; para evitar dois escritores no mesmo campo, a plataforma é a única fonte de estoque desses anúncios e o Pulso controla preço, título e pausa. Pela mesma razão, quando a plataforma emite a DC-e (`marketplace_accounts.dce_emitter = 'platform'`), o Pulso só acompanha a emissão e alerta antes do prazo de 3 dias, sem emitir. O custo do produto sai do saldo pré-pago da plataforma: com o repasse automático desligado, cada pedido é processado pela dona; ligar o repasse automático é decisão registrada da dona, com o saldo da carteira como teto de exposição.
8. Custos fixos só são contratados no dia em que a operação começa a vender, e custos variáveis só depois da venda que os cobre: a assinatura da plataforma é feita com os anúncios prontos para publicar, e a carteira é recarregada pedido a pedido, após a venda.

## Consequências
- Enquanto a conta for pessoa física, o documento do envio é a DC-e emitida pelo vendedor via API logo após a venda.
- Primeira venda real depende de pelo menos um produto e um fornecedor aprovados.
- Rankings oficiais não informam volume; demanda é inferida por posição, persistência e, após anunciar, por visitas e conversão próprias.
- Limites e mudanças de nível são decisões registradas, nunca alteradas pelo agente.

## Referências (consultadas em 2026-11-24)
- https://www.gov.br/inmetro/pt-br/acesso-a-informacao/perguntas-frequentes/avaliacao-da-conformidade/artigos-escolares
- https://developers.mercadolivre.com.br/pt_br/mais-vendidos-no-mercado-livre (atualizada em 2026-06-22)
- https://developers.mercadolivre.com.br/pt_br/tendencias (atualizada em 2025-05-27)
- https://www.mercadopago.com.br/blog/empreendedorismo-digital-no-mercado-livre
