# ADR 0003 — Notificações, fila e reconciliação

Status: proposto · Data: 2026-11-24

## Contexto
- O Mercado Livre envia POST com apenas `resource`, `topic`, `user_id`, `application_id`, `attempts`, `sent`, `received`.
- Resposta exigida: HTTP 200 em até 500 ms; sem isso, o tópico pode ser desativado e o período não fica em `/missed_feeds`.
- Retentativas durante 1 hora; `/missed_feeds` guarda 2 dias. Não há assinatura; a origem é publicada como lista de IPs.
- Mudanças feitas por outros canais (Seller Central, app) também geram notificação.

## Decisão
1. `api/ml-notifications` valida formato, IP de origem e `application_id`; grava em `integration_events` e envia para a fila `ml_notifications`; responde 200. Nenhuma chamada externa nesse caminho.
2. Chave de deduplicação: `(topic, resource)` em janela curta; o worker sempre consulta o estado atual do recurso, então notificações repetidas são inofensivas.
3. O worker consulta o recurso com token, compara `last_updated` com o estado salvo e só aplica se for mais recente.
4. Mensagem com falha volta à fila com backoff; após 5 tentativas vai para `ml_notifications_dlq` e gera alerta.
5. Job a cada 15 minutos: `/missed_feeds` e `/orders/search` por `order.date_last_updated` desde a última reconciliação.
6. Tópicos iniciais: `orders_v2`, `shipments`, `questions`, `messages`, `items`, `post_purchase`.

## Consequências
- O payload da notificação nunca é tratado como dado confiável; a autenticidade vem da reconsulta com token.
- Ordem de chegada não importa: o estado mais recente vence.
- A lista de IPs do Mercado Livre precisa ser revisada periodicamente; IP fora da lista é registrado e descartado.

## Referências (consultadas em 2026-11-24)
- https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes (atualizada em 2026-11-03)
- https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas (atualizada em 2026-09-21)
