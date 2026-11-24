# ADR 0006 — Segredos e tokens OAuth

Status: proposto · Data: 2026-11-24

## Contexto
- Access token do Mercado Livre expira em 6 h; refresh token tem uso único, apenas o último é válido e dura 6 meses.
- Troca de senha, troca do client secret, revogação ou 4 meses sem chamadas invalidam os tokens.
- Vazamento de token permite operar a conta da loja.

## Decisão
- Segredos de aplicação (client secret, chaves de API) apenas em Supabase Secrets das Edge Functions e em GitHub Actions secrets. Nada em repositório, imagem ou log.
- Tokens OAuth gravados criptografados com Supabase Vault, em `marketplace_accounts`, acessíveis apenas por função `security definer` usada pelos workers.
- Renovação com trava por conta (`pg_advisory_xact_lock`) para impedir uso concorrente do mesmo refresh token; renovação apenas quando o access token está a menos de 10 minutos de expirar.
- Falha de renovação marca a conta como `reauthorization_required`, pausa as escritas e gera alerta.
- OAuth com PKCE S256 e `state` aleatório de uso único; `redirect_uri` fixa.
- Logger com redação obrigatória de cabeçalhos `Authorization`, campos `*_token`, `secret` e `password`.
- Varredura de segredos (gitleaks) no pre-commit e no CI.

## Consequências
- Rotação do client secret exige reautorização da conta; procedimento descrito no runbook.
- Testes automatizados verificam que nenhum token aparece em logs.

## Referências (consultadas em 2026-11-24)
- https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao (atualizada em 2025-12-29)
