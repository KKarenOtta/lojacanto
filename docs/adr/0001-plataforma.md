# ADR 0001 — Plataforma: Supabase, Edge Functions e TypeScript

Status: proposto · Data: 2026-11-24

## Contexto
- Operação de uma pessoa; custo fixo deve ser mínimo e a manutenção, baixa.
- O Mercado Livre exige resposta HTTP 200 em até 500 ms às notificações e não oferece sandbox.
- O trabalho é dominado por I/O (chamadas à API, banco), com pouco processamento.

## Decisão
- **Banco:** PostgreSQL gerenciado no Supabase, em uma organização dedicada à loja, separada de outros negócios.
- **Servidor:** Supabase Edge Functions (Deno, TypeScript). Sem servidor sempre ligado.
- **Fila e agendamentos:** `pgmq` e `pg_cron` no próprio Postgres.
- **Linguagem única:** TypeScript no frontend e no backend; SQL para schema, RLS e cálculos agregados.
- **Testes:** `deno test` para `backend/`, pgTAP para o banco, Vitest e Playwright para o frontend.
- **Plano:** Free, na conta Supabase existente, sem novos serviços pagos. Mudança para Pro somente com aprovação, quando houver operação com volume real ou ocorrer pausa por inatividade.

## Alternativas
| Opção | Motivo de não adotar agora |
|---|---|
| Python/FastAPI + Celery + Redis | Exige servidor e worker sempre ligados; mais um runtime e mais custo fixo para o mesmo trabalho de I/O. |
| Cloud Run ou função com escala a zero | Partida a frio pode estourar os 500 ms das notificações. |
| Next.js com rotas de API na Vercel | Plano gratuito da Vercel não permite uso comercial. |
| Neon + Cloudflare Workers (gratuitos) | Duas contas novas; 10 ms de CPU por requisição no plano gratuito do Workers; fila e agendamento exigiriam outro serviço. |

## Consequências
- Limites por requisição das Edge Functions: 256 MB de memória, 2 s de CPU, 150 s de duração no plano Free e 400 s nos pagos. Processamento longo é dividido em mensagens de fila.
- Plano Free: projeto pausado após 1 semana de baixa atividade no banco; limite de 2 projetos ativos por responsável. Os jobs de reconciliação mantêm atividade diária.
- Dependência do Supabase mitigada mantendo `backend/services` sem dependência de runtime e o schema em SQL padrão do Postgres.
- Entrypoints em `supabase/functions/` importam `backend/` por caminho relativo; validado em deploy.

## Referências (consultadas em 2026-11-24)
- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/free-project-pausing
- https://supabase.com/docs/guides/platform/billing-faq
- https://supabase.com/kb/troubleshooting/edge-function-cpu-limits
- https://supabase.com/docs/guides/functions/limits
- https://vercel.com/docs/limits/fair-use-guidelines
