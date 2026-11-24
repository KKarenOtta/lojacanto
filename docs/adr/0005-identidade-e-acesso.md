# ADR 0005 — Autenticação, MFA, RBAC e RLS

Status: proposto · Data: 2026-11-24

## Contexto
- Poucos usuários internos, com acesso a dados financeiros e pessoais de compradores.
- Ações de alto impacto exigem aprovação rastreável.
- A estrutura deve suportar mais de uma loja ou conta de vendedor (troca de CPF para CNPJ, novos canais).

## Decisão
- Supabase Auth com e-mail e senha; MFA TOTP obrigatório para todos os usuários, exigido via nível de garantia `aal2` nas políticas.
- Tenancy por `store_id` em toda tabela de negócio; RLS habilitada em todas as tabelas expostas.
- Papéis por loja em `store_members(role)`: `owner`, `operator`, `finance`, `viewer`. Permissões verificadas no banco (RLS) e em `backend/api`.
- Contas de serviço (workers) usam a chave `service_role` somente no servidor; toda escrita registra o ator no audit log.
- Aprovação de ação exige papel `owner` e não pode ser feita pela mesma identidade que propôs a ação.

## Consequências
- Nenhuma consulta de negócio sem filtro de `store_id`; testes pgTAP verificam isolamento entre lojas e negação de acesso sem `aal2`.
- Sessões expiram e são renovadas pelo Supabase Auth; logout revoga o refresh token do usuário.

## Referências (consultadas em 2026-11-24)
- https://developers.mercadolivre.com.br/pt_br/validacoes-e-requisitos-de-seguranca (atualizada em 2025-12-29)
