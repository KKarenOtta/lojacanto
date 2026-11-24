# Registro de riscos

Nota = probabilidade (1–5) × impacto (1–5). Nota ≥ 15 bloqueia o portão da etapa afetada, salvo aceite registrado; 8–14 exige mitigação com dono; ≤ 7 é monitorado. Revisão a cada portão.

| # | Risco | P × I | Mitigação | Indicador de gatilho | Dono |
|---|---|---|---|---|---|
| R1 | Vendas no CPF caracterizarem atividade empresarial | 4 × 4 = 16 | Registro integral de vendas e custos; migração para CNPJ ao abrir a empresa | Abertura do CNPJ pendente após o início das vendas | Produto (aceito em 2026-11-24) |
| R2 | Fornecedor atrasar despacho ou não aceitar etiqueta do Mercado Livre | 4 × 4 = 16 | Validação do fornecedor antes do anúncio; prazo de disponibilidade realista; segundo fornecedor; alerta antes do prazo | Atraso acima do SLA em > 5% dos pedidos na semana | Produto (bloqueia a primeira venda real) |
| R3 | Desativação de tópicos de notificação | 3 × 4 = 12 | Endpoint só enfileira; `missed_feeds`; reconciliação a cada 15 min | p95 do endpoint > 300 ms; mensagens em DLQ | Engenharia |
| R4 | Falha na renovação de token | 3 × 4 = 12 | Trava por conta; status de reautorização; alerta | Qualquer falha de renovação | Engenharia |
| R5 | Tarifa estimada diferente da cobrada | 4 × 3 = 12 | Consulta com logística; snapshot; conciliação | Divergência > 0,5% no período | Engenharia |
| R6 | Aprovação do app no Mercado Livre demorar | 3 × 3 = 9 | Solicitação imediata; E1 e E2 independentes do app | App não aprovado até o início da E3 | Produto |
| R7 | Mudança nas regras de mensageria pós-venda | 3 × 3 = 9 | Adaptador isolado; testes de contrato; sem envio automático | Falha de contrato | Engenharia |
| R8 | Notificação forjada | 2 × 4 = 8 | Filtro de IP; reconsulta com token | Requisições de IP fora da lista | Engenharia |
| R9 | Excesso de dados pessoais armazenados | 2 × 4 = 8 | Minimização; mascaramento; retenção | Campo pessoal novo sem classificação | Engenharia |
| R10 | Pausa do projeto no plano Free do Supabase | 2 × 4 = 8 | Jobs diários de reconciliação mantêm atividade; Pro mediante aprovação | Aviso de inatividade ou pausa | Engenharia |
| R11 | Entrypoints de `supabase/functions` não importarem `backend/` no deploy | Encerrado | Deploy da função `health` importando `backend/` validado em 2026-11-24 | — | Engenharia |
| R13 | DC-e não emitida em 3 dias corridos cancela o pedido automaticamente | 3 × 4 = 12 | Emissão automática após a venda; alerta no Telegram com 24 h de antecedência | Envio em `invoice_pending` por mais de 24 h | Engenharia |
| R12 | Dependência do Supabase | 2 × 3 = 6 | Serviços sem dependência de runtime; SQL padrão Postgres | — | Engenharia |
