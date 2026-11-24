# ADR 0007 — Logs, auditoria, saúde e alertas

Status: proposto · Data: 2026-11-24

## Contexto
- Operação de uma pessoa: problemas precisam chegar como alerta, não ser descobertos no painel.
- Logs das Edge Functions têm retenção limitada no plano Free.
- Toda ação sobre a loja precisa ser rastreável.

## Decisão
- **Logs técnicos:** JSON estruturado com `level`, `event`, `correlation_id`, `store_id`, `duration_ms`; dados pessoais mascarados.
- **Auditoria:** tabela `audit_events` somente INSERT (sem permissão de UPDATE/DELETE para nenhum papel), com hash encadeado `prev_hash`/`hash`; registra ator, ação, entidade, antes/depois e `correlation_id`.
- **Saúde:** `ops.health_checks` alimentada por job a cada 5 minutos: idade da última sincronização, tamanho da fila, itens na DLQ, falhas de renovação de token, pedidos perto do prazo de despacho, latência do endpoint de notificações.
- **Alertas:** regras em `monitoring/` avaliadas pelo mesmo job; severidade crítica envia mensagem por bot do Telegram. Token e chat lidos dos secrets `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` das Edge Functions; o conteúdo do alerta não inclui dados pessoais.
- **Kill switch:** flags em `ops.feature_flags`, global e por módulo; quando ativo, workers só leem e alertam.

## Consequências
- Diagnóstico de incidentes usa `correlation_id` do evento de entrada até a ação final.
- Indicadores do `docs/risk-register.md` vêm de consultas sobre essas tabelas.
