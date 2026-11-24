# Portões de qualidade

Cada etapa termina com um Relatório de Portão: critério, evidência verificável (comando e resultado, execução do CI, commit) e pendências. Critério sem evidência conta como não atendido. A etapa seguinte só começa após aprovação registrada abaixo. Limiares mudam apenas por decisão registrada.

## Critérios

| Etapa | Critérios |
|---|---|
| E0 Auditoria | Repositório sem alterações; capacidades da API confirmadas em documentação oficial com data; perguntas bloqueadoras registradas |
| E1 Arquitetura | ADRs de plataforma, frontend, filas, finanças, acesso, segredos e observabilidade; modelo de domínio; modelo de ameaças com mitigação por ameaça; todo risco ≥ 15 com dono, etapa bloqueada indicada ou aceite registrado |
| E2 Fundação técnica | CI verde com lint, format, typecheck, testes, varredura de segredos e de dependências; cobertura ≥ 80% no código novo; RLS testada com casos negativos e isolamento por loja; `audit_events` rejeita UPDATE/DELETE; migrações aplicadas do zero em banco limpo; deploy de teste das Edge Functions importando `backend/` |
| E3.1 Dados e integrações — núcleo | Testes de contrato com fixtures; notificação repetida 100 vezes gera um único efeito; eventos fora de ordem não regridem estado; tokens ausentes dos logs (teste automatizado); falha esgotada vai para a fila de falhas com alerta; kill switch interrompe o processamento |
| E3.2 Dados e integrações — conexão | OAuth com usuário de teste; renovação de token sem concorrência; reconciliação recupera 100% dos eventos omitidos no cenário de teste; p95 do endpoint de notificações < 300 ms em produção; migração e funções publicadas após aprovação. Pode ocorrer em paralelo à E4 por depender da aprovação externa da aplicação |
| E4 Motor financeiro | 100% das fórmulas com testes unitários e de propriedade; casos de custo ausente, tarifa alterada, devolução parcial e arredondamento; divergência zero contra planilha de referência em ≥ 30 pedidos; pedido sem custo essencial bloqueado para recomendação |
| E5 Logística e fornecedores | Motor de seleção conforme ADR 0008 com filtros eliminatórios e pontuação testados; recomendações reproduzíveis a partir de fixtures; todas as transições válidas e inválidas testadas; alerta antes do prazo de despacho em 100% dos cenários; score de fornecedor com amostra mínima e incerteza; fluxo manual testado para fornecedor sem API |
| E6 Painel | E2E dos fluxos principais; valores exibidos iguais aos da camada de cálculo; p95 de carregamento < 2 s com volume de teste; contraste e navegação WCAG AA; nenhum dado pessoal sem permissão |
| E7 IA assistiva | Conjunto de avaliação versionado com ≥ 200 casos; acurácia de classificação ≥ 90% e recall de casos sensíveis ≥ 98%; zero valores inventados; suíte de prompt injection sem violações; 100% das saídas válidas no schema; custo por interação dentro do orçamento |
| E8 Automação limitada | Cada ação com política, limite, aprovador, expiração e compensação testados; kill switch com efeito em < 1 min; repetição não duplica efeito; execução só com usuários de teste até aprovação do rollout |
| E9 Experimentação | Hipótese, métrica primária, guardrails, amostra mínima e janela registrados antes do início; guardrail violado interrompe o experimento |
| E10 Lançamento | Checklist de prontidão completo; restauração de backup testada; runbooks ensaiados; nenhum achado de segurança crítico ou alto aberto; RIPD revisado; 7 dias de operação assistida sem incidente crítico |

## Registro

| Etapa | Data | Commit | Resultado | Ressalvas |
|---|---|---|---|---|
| E0 | 2026-11-24 | — (repositório vazio) | Aprovado | — |
| E1 | 2026-11-24 | 862a65c | Aprovado | — |
| E2 | 2026-11-24 | 2117316 | Aprovado | — |
| E3.1 | 2026-11-24 | b99109a | Aprovado | E3.2 aberta até a aprovação da aplicação no Mercado Livre |
