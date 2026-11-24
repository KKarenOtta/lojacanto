# Modelo de ameaças (STRIDE)

Ativos: tokens OAuth do Mercado Livre, dados pessoais de compradores, dados financeiros, capacidade de alterar anúncios e responder clientes, audit log.

Fronteiras de confiança: internet → `api/ml-notifications`; navegador → Supabase (RLS) e `backend/api`; workers → API do Mercado Livre e fornecedores; conteúdo externo → modelos de IA (a partir da E7).

| # | Categoria | Ameaça | Mitigação |
|---|---|---|---|
| T1 | Spoofing | Notificação forjada para induzir processamento | Filtro de IPs publicados, validação de `application_id`, payload nunca usado como dado: o recurso é sempre reconsultado com token (ADR 0003) |
| T2 | Spoofing | Sessão do painel roubada ou senha vazada | MFA TOTP obrigatório (`aal2`), expiração de sessão, revogação no logout (ADR 0005) |
| T3 | Spoofing | Callback OAuth forjado ou CSRF no fluxo de autorização | PKCE S256, `state` aleatório de uso único, `redirect_uri` fixa (ADR 0006) |
| T4 | Tampering | Alteração de dados de outra loja ou de papel sem permissão | RLS por `store_id` e papel; testes pgTAP de isolamento |
| T5 | Tampering | Alteração do histórico de auditoria | Tabela somente INSERT com hash encadeado; verificação periódica da cadeia (ADR 0007) |
| T6 | Tampering | Injeção SQL ou de payload malformado | Queries parametrizadas, validação de entrada por schema no backend |
| T7 | Repudiation | Ação executada sem autoria comprovável | `audit_event` com ator, aprovador, payload e `correlation_id` |
| T8 | Information disclosure | Token ou segredo em log, repositório ou frontend | Secrets do Supabase e GitHub, Vault para tokens, redação no logger, gitleaks, frontend só com chave pública (ADR 0006) |
| T9 | Information disclosure | Excesso de dados pessoais armazenados ou exibidos | Não solicitar dados pessoais completos por padrão; mascaramento; retenção definida; acesso por papel |
| T10 | Information disclosure | Dados pessoais enviados a provedor de IA | A partir da E7: minimização e mascaramento antes do envio, provedor sem uso para treino |
| T11 | Denial of service | Inundação do endpoint de notificações | Endpoint só enfileira; descarte por IP; limite de tamanho; DLQ e alerta |
| T12 | Denial of service | Bloqueio por excesso de chamadas ao Mercado Livre (429) | Limitador por endpoint, backoff com jitter, circuit breaker |
| T13 | Elevation of privilege | Uso da chave `service_role` fora do servidor | Chave apenas em Secrets das Edge Functions; varredura no build do frontend |
| T14 | Elevation of privilege | Conteúdo externo induzindo ação (prompt injection) | IA sem ferramentas de escrita; ações passam pelo orquestrador com política em código e aprovação humana |
| T15 | Elevation of privilege | Execução automática de ação de alto impacto | Níveis de autonomia em configuração versionada; aprovação por identidade diferente; kill switch |
