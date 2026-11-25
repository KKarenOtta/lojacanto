# Gmail API

Fontes oficiais consultadas em 2026-11-28:
- OAuth 2.0 para aplicativos de servidor web: https://developers.google.com/identity/protocols/oauth2/web-server
- OpenID Connect: https://developers.google.com/identity/openid-connect/openid-connect
- Níveis de uso das APIs do Workspace: https://developers.google.com/workspace/guides/quota-usage-tiers

## Projeto e cliente
- Projeto Google Cloud `pulso-canto-util`; Gmail API ativada no nível Standard, sem custo.
- Público externo; cliente web `pulso-gmail-sender`.
- Redirecionamento autorizado: `https://fsweunictubyjajwffwr.supabase.co/functions/v1/gmail-oauth/callback`.
- Escopos: `openid`, `email` e `https://www.googleapis.com/auth/gmail.send` (confidencial). Nenhum escopo de leitura.

## Fluxo de autorização
1. `GET /functions/v1/gmail-oauth/start` gera `state` e verificador PKCE, grava ambos em cookie `HttpOnly; Secure; SameSite=Lax` restrito ao caminho da função (10 minutos) e redireciona com `access_type=offline` e `prompt=consent`.
2. `GET /functions/v1/gmail-oauth/callback` confere o `state`, troca o código no endpoint de token com o verificador e exige `gmail.send` entre os escopos concedidos e a presença de `refresh_token`.
3. O `id_token` recebido diretamente do endpoint de token é aceito sem verificação de assinatura, conforme a documentação de OpenID Connect; `aud`, `iss` e `exp` são conferidos. A conta precisa ser a configurada em `GMAIL_SENDER`, com e-mail verificado.
4. O refresh token vai ao Vault por `store_email_credentials`; nunca é devolvido nem registrado em log.

## Renovação e revogação
- `refreshAccessToken` usa `grant_type=refresh_token`; `invalid_grant` indica token revogado ou expirado e leva a `mark_email_reauthorization_required`.
- Em status de publicação "Teste", o refresh token expira em 7 dias; a operação contínua exige o app publicado.

## Segredos da função
`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GMAIL_OAUTH_REDIRECT_URI`, `GMAIL_SENDER`, `STORE_ID`.
