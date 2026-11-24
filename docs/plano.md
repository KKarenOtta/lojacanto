# Plano de construção

Lista única do trabalho restante, atualizada em cada pull request. Critérios de aprovação ficam em `quality-gates.md`, riscos em `risk-register.md` e decisões técnicas em `adr/`; aqui entram apenas tarefas, dependências e situação.

Atualizado em 2026-11-24.

## Situação

| Etapa | Situação | Branch / PR |
|---|---|---|
| E0 Auditoria | Aprovada | — |
| E1 Arquitetura | Aprovada | #1 |
| E2 Fundação técnica | Aprovada | #2 |
| E3.1 Dados e integrações — núcleo | Aprovada | `e3-integracoes` / #6 (rascunho) |
| E3.2 Dados e integrações — conexão | Aguardando aplicação no Mercado Livre | `e3-integracoes` / #6 |
| E4 Motor financeiro | Em andamento | `e4-financeiro` |
| E5 a E10 | Não iniciadas | — |

## E3.2 Dados e integrações — conexão

- [ ] Solicitar a aplicação no DevCenter (nome, descrição, escopos `read`, `write`, `offline_access`, tópicos, URL de retorno)
- [ ] Configurar `ML_APP_ID` e o segredo da aplicação nas Edge Functions
- [ ] OAuth Authorization Code com PKCE: início, retorno e gravação dos tokens no Vault
- [ ] Renovação do token com trava por conta e status de reautorização
- [ ] Criar usuários de teste (vendedor e comprador)
- [ ] Edge Function do worker de pedidos e agendamento com `pg_cron`
- [ ] Reconciliação por `/orders/search` e `/missed_feeds`
- [ ] Reprocessamento da fila de falhas
- [ ] Merge do PR #6, aplicar a migração em produção e publicar `ml-notifications`
- [ ] Medir p95 do endpoint de notificações em produção
- [ ] Relatório de Portão E3.2

## E4 Motor financeiro

- [x] Confirmar na documentação oficial a estrutura de `/sites/MLB/listing_prices`
- [x] Leitura de `listing_prices` com logística e modo de envio
- [x] Estimativa do custo de envio do vendedor (Mercado Envios 2)
- [x] Fonte do custo de envio e da tarifa realmente cobrados por pedido (`/shipments/{id}/costs` e `sale_fee` do pedido)
- [x] Fornecedores e ofertas com custo, frete do fornecedor, prioridade e vigência sem sobreposição
- [x] Parâmetros financeiros versionados por vigência (impostos zerados enquanto não houver CNPJ)
- [x] Cálculos puros em `backend/services/finance`: receita, comissão, tarifa fixa, frete, custo, impostos, contribuição, margem e preço mínimo
- [x] Regra de arredondamento única (meio centavo para longe de zero) e testes de propriedade
- [x] Snapshot de custo imutável por item ao gravar o pedido; margem `unknown` sem custo essencial
- [ ] Lançamentos estimados e realizados, conciliação e registro da divergência
- [ ] Casos de tarifa alterada, devolução parcial e cancelamento
- [ ] Planilha de referência com 30 pedidos simulados para conferência manual
- [ ] Relatório de Portão E4

## E5 Logística e fornecedores

- [ ] Confirmar na documentação oficial as regras do Mercado Livre para venda sem estoque próprio
- [ ] Pesquisa de nicho: mais vendidos, tendências e visitas por categoria, cruzados com margem estimada pelo motor financeiro
- [ ] Busca e qualificação de fornecedores: custo, prazo de despacho, aceite da etiqueta do Mercado Livre, estoque e reputação
- [ ] Lista priorizada de produtos e fornecedores para aprovação humana antes do primeiro anúncio
- [ ] SLA, canal de pedido e estoque informado por fornecedor
- [ ] Prazo de despacho a partir de `estimated_handling_limit` e alertas antes do vencimento
- [ ] Pedido de compra ao fornecedor com fluxo manual (sem API)
- [ ] Etiqueta via `/shipment_labels` associada ao pedido de compra
- [ ] Score de fornecedor com amostra mínima e incerteza
- [ ] Relatório de Portão E5

## E6 Painel

- [ ] Projeto Vite + React no Cloudflare Pages
- [ ] Login com MFA obrigatório
- [ ] Visões executiva, operacional, financeira, fornecedores, atendimento e centro de ações
- [ ] Teste de consistência entre valores exibidos e camada de cálculo
- [ ] E2E, desempenho e acessibilidade
- [ ] Relatório de Portão E6

## E7 IA assistiva

- [ ] Conjunto de avaliação versionado com 200 casos rotulados
- [ ] Classificação de perguntas e mensagens
- [ ] Rascunhos factuais com fontes do próprio banco, sem envio automático
- [ ] Explicação de recomendações
- [ ] Suíte de prompt injection, validação de schema e orçamento de custo por interação
- [ ] Relatório de Portão E7

## E8 Automação limitada

- [ ] Orquestrador de ações com política, limite, aprovador, expiração, idempotência e compensação
- [ ] Kill switch por módulo
- [ ] Testes de abuso de ferramentas
- [ ] Relatório de Portão E8

## E9 Experimentação

- [ ] Registro de experimento com hipótese, métrica primária, guardrails, amostra mínima e janela
- [ ] Interrupção automática por guardrail
- [ ] Relatório de Portão E9

## E10 Lançamento

- [ ] Checklist de prontidão, backup e restauração com RPO e RTO medidos
- [ ] Runbooks de incidente, rollback e kill switch ensaiados
- [ ] Revisão de segurança e RIPD
- [ ] Rollout canário e 7 dias de operação assistida
- [ ] Relatório de Portão E10

## Após o MVP

- [ ] Canal Instagram

## Manutenção

- [ ] Revisar e integrar as atualizações do Dependabot (#3, #4, #5)

## Dependências externas e decisões

| Item | Responsável | Bloqueia |
|---|---|---|
| Verificação de documentos no Mercado Pago | Mercado Pago | Solicitação da aplicação |
| Aprovação da aplicação no Mercado Livre (até 10 dias) | Mercado Livre | E3.2 |
| Abertura do CNPJ próprio | Karen | Migração da conta para CNPJ; impostos na E4 (R1) |
| Aprovar a lista inicial de produtos e fornecedores proposta pelo sistema | Karen | Primeira venda real (R2) |
| Conferência manual da planilha de referência | Karen | Portão E4 |
| Criar conta gratuita no Cloudflare | Karen | E6 |
| Excluir as branches `e1-arquitetura` e `e2-fundacao` e ativar exclusão automática de branches | Karen | — |
