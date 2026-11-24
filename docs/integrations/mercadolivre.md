# Mercado Livre — capacidades confirmadas

Base: `https://api.mercadolibre.com`, site `MLB`. Documentação oficial consultada em 2026-11-24; a data entre parênteses é a última atualização publicada de cada página.

| Recurso | Endpoint | Regras relevantes | Fonte |
|---|---|---|---|
| Autorização | `auth.mercadolivre.com.br/authorization`, `POST /oauth/token` | Authorization Code com PKCE opcional; access token 6 h; refresh token de uso único, 6 meses; escopos `read`, `write`, `offline_access`; autorização pelo administrador da conta | [autenticacao-e-autorizacao](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao) (2025-12-29) |
| Usuários de teste | `POST /users/test_user` | Sem sandbox; até 10 usuários de teste por conta; operações apenas entre usuários de teste | [realizacao-de-testes](https://developers.mercadolivre.com.br/pt-br/realizacao-de-testes) |
| Notificações | callback POST; `GET /missed_feeds?app_id=` | HTTP 200 em até 500 ms; retentativas por 1 h; histórico de 2 dias; sem assinatura, IPs de origem publicados | [produto-receba-notificacoes](https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes) (2026-11-03) |
| Pedidos | `GET /orders/{id}`, `GET /orders/search`, `GET /orders/{id}/shipments` | `pack_id` agrupa carrinho; `X-Api-Version: 2` retorna dados pessoais completos do destinatário | [gerenciamento-de-vendas](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas) (2026-09-21) |
| Envios | `GET /shipments/{id}` (`X-Format-New: true`), `GET /shipment_labels` | Etiqueta PDF ou ZPL com status `ready_to_ship`; prazo em `estimated_handling_limit`; logísticas `drop_off`, `xd_drop_off`, `self_service`, `fulfillment` | [mercado-envios-2](https://developers.mercadolivre.com.br/pt_br/mercado-envios-2) (2026-07-06) |
| Tarifas | `GET /sites/MLB/listing_prices?price&currency_id&category_id&listing_type_id&logistic_type&shipping_mode` | Resposta em lista por tipo de anúncio: `sale_fee_amount` (comissão + taxa fixa), `sale_fee_details.percentage_fee` (percentual total), `sale_fee_details.fixed_fee`. Sem `logistic_type` e `shipping_mode` a taxa fixa calculada não coincide com a cobrada. MLB: preço ≥ limite de frete grátis não tem taxa fixa; abaixo do limite, em ME2 só Flex (`self_service`) cobra taxa fixa; ME1, `custom` e `not_specified` sempre cobram. O percentual pode variar no tempo para o mesmo produto | [comissao-por-vender](https://developers.mercadolivre.com.br/pt_br/comissao-por-vender) (2026-09-03) |
| Custo de envio do vendedor | `GET /users/{id}/shipping_options/free?item_id|dimensions&item_price&listing_type_id&mode&logistic_type&free_shipping&verbose` | Estimativa por unidade em `coverage.all_country.list_cost`; `discount` só aparece quando há desconto; consultar com `free_shipping` verdadeiro e falso. Tag `mandatory_free_shipping` no anúncio indica preço acima do limite e frete grátis obrigatório em ME2 | [custos-de-envio](https://developers.mercadolivre.com.br/pt_br/custos-de-envio) (2026-04-20) |
| Perguntas | `GET /questions/search?api_version=4`, `POST /answers` | Perguntas sem resposta há mais de 7 meses são excluídas | [gerenciamento-perguntas-respostas](https://developers.mercadolivre.com.br/pt_br/gerenciamento-perguntas-respostas) (2023-09-29) |
| Mensagens pós-venda | `GET`/`POST` de mensagens por pack | Agente de mensageria do MLB (user_id 3037675074) intermedia conversas; vendedor não inicia; 1 mensagem por vez; 48 h úteis antes do bloqueio; 500 rpm leitura e 500 rpm escrita | [mensagens-post-venda](https://developers.mercadolivre.com.br/pt_br/mensagens-post-venda) (2026-10-27) |
| Visitas | `GET /users/{id}/items_visits` | Janela máxima de 150 dias | [recurso-visits](https://developers.mercadolivre.com.br/pt_br/recurso-visits) (2026-01-02) |
| Limites | — | Sem números públicos, exceto mensagens; controle por aplicação e endpoint; backoff com jitter | [rate-limit-erro-429](https://developers.mercadolivre.com.br/pt_br/rate-limit-erro-429) (2026-05-05) |
| Aplicação | formulário no portal | Análise e aprovação em até 10 dias | [crie-uma-aplicacao-no-mercado-livre](https://developers.mercadolivre.com.br/pt_br/crie-uma-aplicacao-no-mercado-livre) (2026-11-23) |

## Contratos usados no código

- Origem das notificações: os 92 IPs publicados em produto-receba-notificacoes estão em `backend/integrations/mercadolivre/notifications.ts`; revisar a cada mudança da página.
- Status de pedido aceitos: `confirmed`, `payment_required`, `payment_in_process`, `partially_paid`, `paid`, `partially_refunded`, `pending_cancel`, `cancelled`, `invalid`. Status fora da lista gera `ContractError` e o evento vai para a fila de falhas.
- Fixtures em `backend/integrations/mercadolivre/fixtures/` reproduzem os exemplos da documentação oficial; o de `listing_prices` é do site MLA, único exemplo publicado.
- A tarifa estimada é sempre consultada na API com logística; o limite de frete grátis não é fixado no código.

## Não confirmado
- Regras oficiais da plataforma para vendas sem estoque próprio.
- Limites numéricos de requisição por endpoint, exceto mensagens.
