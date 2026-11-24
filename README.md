# Pulso

Plataforma de operação e otimização da loja Canto Útil no Mercado Livre: pedidos, fornecedores, envios, atendimento, finanças e recomendações com rastreabilidade.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `frontend/` | Painel web (SPA) |
| `backend/` | Código de servidor em TypeScript: rotas, serviços, integrações, workers |
| `supabase/` | Banco de dados (migrações, políticas, testes) e configuração de deploy |
| `monitoring/` | Verificações de saúde e regras de alerta |
| `tests/` | Testes ponta a ponta |
| `docs/` | Arquitetura, decisões (ADR), domínio, segurança, riscos e portões de qualidade |

Detalhes em [docs/architecture.md](docs/architecture.md).
