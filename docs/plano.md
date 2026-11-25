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
| E4 Motor financeiro | Aprovada | `e4-financeiro` / #7 (rascunho) |
| E5 Logística e fornecedores | Em andamento | `e5-logistica` |
| Motor de seleção de produtos | Em andamento, em paralelo | `e5-logistica` |
| E6 a E10 | Não iniciadas | — |

## E3.2 Dados e integrações — conexão

- [x] Nome de usuário da conta de vendedora: CANTOUTIL
- [x] Logo e capa da Minha Página prontos (canvas de design)
- [ ] Solicitar a aplicação no DevCenter (nome, descrição, escopos `read`, `write`, `offline_access`, tópicos, URL de retorno)
- [ ] Configurar `ML_APP_ID` e o segredo da aplicação nas Edge Functions
- [ ] OAuth Authorization Code com PKCE: início, retorno e gravação dos tokens no Vault
- [ ] Renovação do token com trava por conta e status de reautorização
- [ ] Criar usuários de teste (vendedor e comprador)
- [ ] Edge Function do worker de pedidos e agendamento com `pg_cron`
- [ ] Reconciliação por `/orders/search` e `/missed_feeds`
- [ ] Reprocessamento da fila de falhas
- [ ] Leitura de `money_release_date` dos pagamentos para a data de caixa
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
- [x] Lançamentos estimados e realizados imutáveis, conciliação por tipo e divergência com tolerância
- [x] Casos de tarifa alterada (conciliação), devolução parcial e total, custo ausente e arredondamento
- [x] 30 pedidos de referência calculados de forma independente e comparados ao motor (`fixtures/reference_orders.json`)
- [x] Competência e caixa por lançamento; despesas fixas com vigência
- [x] DRE gerencial, ponto de equilíbrio, projeção de caixa e bloqueio de compra sem capital de giro
- [x] Conferência manual da planilha de referência (aprovada em 2026-11-24)
- [x] Relatório de Portão E4

## Motor de seleção de produtos (em paralelo à E4, ADR 0008)

- [x] Leitura de `/highlights` e `/trends` com fixtures oficiais
- [x] Filtros eliminatórios de produto (categoria regulada, marca, peso e dimensões, fragilidade)
- [x] Pontuação de produto com margem sob estresse, persistência de demanda, concorrência e devolução esperada
- [x] Critérios eliminatórios de fornecedor
- [ ] Pesquisa web de produtos e fornecedores candidatos até a liberação da API
- [x] Calendário sazonal (volta às aulas de novembro a fevereiro, 6 semanas de antecedência)
- [x] Regras de kit: composição por SKU, certificação e embalagem de cada item, fornecedor único e montagem conforme Anexo B
- [x] Seleção semanal com motivos de rejeição, registro no banco e decisão da dona
- [ ] Agendamento da seleção semanal com custos do catálogo do fornecedor (após o cadastro na Silkdrop)
- [x] Confirmar exigências fiscais para venda por CPF (DC-e emitida pelo vendedor)

## E5 Logística e fornecedores

- [ ] Busca e qualificação de fornecedores nacionais conforme ADR 0008, com pedido-teste
- [x] SLA, canal de pedido e critérios de elegibilidade por fornecedor
- [ ] Estoque informado pelo fornecedor e sincronização com o anúncio
- [x] Contratos de DC-e e prazo de despacho (`/sla`) com fixtures oficiais
- [x] Níveis de prazo (aviso, crítico, vencido) e prazo da DC-e
- [x] Emissão automática da DC-e logo após a venda, com alerta antes do prazo de 3 dias (worker com fixtures; agendamento na E3.2)
- [x] Prazo de despacho pelo `/shipments/{id}/sla` com alerta na mudança de nível (worker com fixtures; agendamento na E3.2)
- [x] Pedido de compra com máquina de estados, aprovação do dono, kill switch e auditoria
- [x] Mensagem pronta ao fornecedor, sem dados do comprador
- [x] Confirmação e rastreio informados pelo fornecedor no fluxo manual, com rastreio obrigatório no despacho
- [ ] Etiqueta via `/shipment_labels` anexada ao pedido de compra por e-mail (canal `email`; no canal `platform` a plataforma entrega a etiqueta)
- [x] Score de fornecedor com amostra mínima e intervalo de Wilson
- [ ] Relatório de Portão E5

## Comunicação automatizada (ADR 0009)

- [x] Política de envio, modelos de prospecção e lembrete, detecção de descadastro
- [x] Cliente Gmail API com proteção contra injeção de cabeçalho
- [x] Projeto Google Cloud, Gmail API e cliente OAuth `pulso-gmail-sender` (escopo `gmail.send`)
- [x] Função `gmail-oauth` com estado em cookie, PKCE, conferência da conta e token no Vault
- [x] Páginas de início e privacidade em `site/`
- [x] Fila de mensagens com aprovação, lista de descadastro e auditoria no banco
- [x] Worker de envio com renovação do token de acesso e pausa por reautorização
- [ ] Implantação junto com a E3.2: migrações, função `gmail-oauth`, segredos e GitHub Pages
- [ ] Publicar o app OAuth em produção e autorizar a conta da loja
- [x] Planejador de prospecção com política de envio, modelos aprovados e estágio do fornecedor
- [ ] Agendamento dos workers de prospecção e envio (com a E3.2)
- [ ] Leitura das respostas e atualização da ficha do fornecedor
- [x] Painel de fornecedores com escolha de plano, aceite de custo e etapas até o pedido-teste
- [x] Fornecedor do MVP escolhido: Silkdrop, plano mensal; mensagem de qualificação enviada
- [x] Canal `platform`, horário de corte e data prevista de postagem em dias úteis
- [x] Respostas da Silkdrop: integração oficial com o Mercado Livre, etiqueta oficial, embalagem sem preço ou propaganda, corte às 13h, estoque sincronizado, CPF aceito, sem taxa por pedido, garantia de 30 dias
- [x] Silkdrop: custo pago por saldo pré-pago (Pix ou cartão), com repasse automático opcional; DC-e emitida pela plataforma em conta CPF
- [x] Emissor da DC-e por conta (`pulso` ou `platform`), sem emissão em duplicidade
- [ ] Conferir no catálogo as categorias casa, cozinha, organização, papelaria e home office (sem confirmação da Silkdrop)
- [ ] Itens escolares regulados (Portaria Inmetro 423/2021) só com certificação visível no anúncio do fornecedor; cadernos e demais itens fora da portaria seguem sem essa exigência
- [ ] Responsável por defeito de fábrica dentro da garantia: confirmar nos termos ou na primeira ocorrência; até lá, custo assumido pela loja no cenário de estresse
- [x] Avaliações do produto (nota e quantidade) como sinal na pontuação de seleção
- [ ] Sincronizar escolhas do painel com `suppliers` após a implantação
- [ ] Lista de fábricas e atacadistas com e-mail comercial publicado (após o CNPJ)

## Dia de início das vendas (ADR 0008, item 8)

Antes, sem custo:
- [ ] Verificação de documentos no Mercado Pago concluída
- [x] Envios no Mercado Livre ativo: endereço de envio e de devolução no CDE da Silkdrop, portaria de segunda a sexta, 8h às 20h
- [ ] Conferir prazo de despacho
- [ ] Endereço de faturamento: trocar pelo endereço fiscal do CPF após confirmar com o Mercado Livre se aparece para compradores
- [ ] Na primeira venda, conferir na etiqueta quais dados do remetente são impressos
- [x] Pré-seleção de 15 produtos dos mais vendidos do Mercado Livre nas categorias do nicho, no painel de fornecedores
- [ ] Modelos de título, descrição e preço mínimo por margem prontos para aplicar

No dia, em sequência:
- [ ] Assinar a Silkdrop no plano mensal (garantia de 7 dias)
- [ ] Cruzar o catálogo com a pré-seleção e calcular a margem de cada produto
- [ ] Aprovar e publicar os primeiros anúncios
- [ ] Repasse automático desligado; carteira recarregada pedido a pedido, após cada venda
- [ ] Se o catálogo não atender o nicho com margem, cancelar dentro dos 7 dias
- [ ] Ativar a Minha Página com logo e capa (3 meses grátis, depois R$ 99/mês com renovação automática); decidir antes do 90º dia se mantém ou pausa

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
- [ ] Assistente de perguntas pré-venda do Mercado Livre: resposta a partir da ficha do anúncio, do fornecedor e das políticas da loja, com aprovação da dona no nível L1 e envio automático só dentro da política no nível L2
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

## Expansão por métricas (ADR 0010)

- [ ] Preço de referência do Alibaba no motor de seleção
- [ ] Métricas por canal e produto: margem de contribuição, custo de aquisição, conversão, recompra, reputação, incidentes e giro
- [ ] Avaliação semanal dos portões com alerta quando todas as condições forem atendidas
- [ ] Portão Amazon: integração SP-API e fornecedores com embalagem neutra
- [ ] Portão loja própria: plataforma, gateway, transportadora e teste de 60 dias
- [ ] Portão importação: Siscomex e compra em lote para o Full

## Após o CNPJ

- [ ] Emissão de NF-e com o leiaute da Reforma Tributária (NT 2025.002, IBS/CBS/IS) e importação da nota em `/shipments/{id}/invoice_data`

## Após o MVP

- [ ] Canal Instagram (condição do portão de loja própria)

## Manutenção

- [ ] Revisar e integrar as atualizações do Dependabot (#3, #4, #5)

## Dependências externas e decisões

| Item | Responsável | Bloqueia |
|---|---|---|
| Verificação de documentos no Mercado Pago | Mercado Pago | Solicitação da aplicação |
| Aprovação da aplicação no Mercado Livre (até 10 dias) | Mercado Livre | E3.2 |
| Validar com contador o tratamento da venda por CPF (equiparação a PJ) e o enquadramento do novo CNPJ (MEI ou ME no Simples Nacional) | Karen | Parâmetro de imposto da E4; R1 |
| Registro da marca Canto Útil no INPI, após o CNPJ | Karen | Proteção do nome; Loja Oficial |
| Abertura do CNPJ próprio | Karen | Migração da conta para CNPJ; impostos na E4 (R1) |
| Aprovar produtos e fornecedores recomendados (nível L1) | Karen | Primeira venda real (R2) |
| Conferência manual da planilha de referência | Karen | Portão E4 |
| Criar conta gratuita no Cloudflare | Karen | E6 |
| Gravar os segredos do cliente OAuth no Supabase e autorizar a conta da loja, após a implantação da E3.2 | Karen | Comunicação automatizada |
| Excluir as branches `e1-arquitetura` e `e2-fundacao` e ativar exclusão automática de branches | Karen | — |
