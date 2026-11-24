begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'owner-g@test.local'),
  ('00000000-0000-0000-0000-0000000000b9', 'viewer-g@test.local');

insert into public.stores (id, name) values ('10000000-0000-0000-0000-0000000000a9', 'Loja G');
insert into public.store_members (store_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a9', 'owner'),
  ('10000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000b9', 'viewer');

insert into public.marketplace_accounts (id, store_id, channel, seller_id, status) values
  ('30000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-0000000000a9', 'mercadolivre', 478055421, 'active');

select public.apply_order_snapshot(
  '30000000-0000-0000-0000-0000000000a9',
  jsonb_build_object(
    'external_id', 2000000000000009, 'pack_id', null, 'shipping_id', 40000000009, 'status', 'paid',
    'status_detail', null, 'currency', 'BRL', 'total_cents', 7990, 'paid_cents', 7990,
    'is_test', true, 'created_at', '2026-11-21T12:00:00Z', 'closed_at', null,
    'last_updated', '2026-11-21T12:00:00Z',
    'items', jsonb_build_array(jsonb_build_object('item_id', 'MLB0000000009', 'variation_id', null,
      'title', 'G', 'quantity', 1, 'unit_price_cents', 7990, 'sale_fee_cents', 1119,
      'listing_type_id', 'gold_special'))
  ),
  null,
  'awaiting_supplier'
);

create temporary table target as select id from public.orders where external_id = 2000000000000009;

select is(
  public.record_financial_entries((select id from target), $$[
    {"kind": "revenue", "basis": "estimated", "amount_cents": 7990, "source": "pricing"},
    {"kind": "sale_fee", "basis": "estimated", "amount_cents": 1119, "source": "pricing"},
    {"kind": "seller_shipping", "basis": "estimated", "amount_cents": 0, "source": "pricing"},
    {"kind": "revenue", "basis": "realized", "amount_cents": 7990, "source": "order"},
    {"kind": "sale_fee", "basis": "realized", "amount_cents": 1119, "source": "order"},
    {"kind": "seller_shipping", "basis": "realized", "amount_cents": 819, "source": "shipment:40000000009", "settlement_date": "2026-12-05"}
  ]$$::jsonb),
  6,
  'lançamentos estimados e realizados são gravados'
);

select is(
  public.record_financial_entries((select id from target), $$[
    {"kind": "revenue", "basis": "realized", "amount_cents": 7990, "source": "order"}
  ]$$::jsonb),
  0,
  'lançamento repetido não duplica'
);

select results_eq(
  $$ select kind::text, estimated, realized, divergence from public.order_reconciliation
     where order_id = (select id from target) order by kind $$,
  $$ values ('revenue', 79.90::numeric, 79.90::numeric, 0.00::numeric),
            ('sale_fee', 11.19::numeric, 11.19::numeric, 0.00::numeric),
            ('seller_shipping', 0.00::numeric, 8.19::numeric, 8.19::numeric) $$,
  'conciliação mostra a divergência do frete'
);

select is(
  (select accrual_date from public.financial_entries where source = 'pricing' and kind = 'revenue'),
  '2026-11-21'::date,
  'competência padrão é a data do pedido no fuso de São Paulo'
);
select is(
  (select settlement_date from public.financial_entries where source = 'shipment:40000000009'),
  '2026-12-05'::date,
  'data de caixa é registrada quando informada'
);

select public.record_financial_entries((select id from target), $$[
  {"kind": "refund", "basis": "realized", "amount_cents": 3995, "source": "claim:5001"},
  {"kind": "refund", "basis": "realized", "amount_cents": 1000, "source": "claim:5002"}
]$$::jsonb);
select is(
  (select realized from public.order_reconciliation where order_id = (select id from target) and kind = 'refund'),
  49.95::numeric,
  'devoluções parciais distintas se somam'
);

select throws_ok(
  $$ update public.financial_entries set amount = 0 $$, '42501', null, 'lançamento não pode ser alterado'
);
select throws_ok(
  $$ select public.record_financial_entries((select id from target), '[{"kind": "bonus", "basis": "realized", "amount_cents": 1, "source": "x"}]'::jsonb) $$,
  '22P02', null, 'tipo de lançamento desconhecido é recusado'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000b9', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select is_empty($$ select * from public.order_reconciliation $$, 'visualizador não vê a conciliação');
select throws_ok(
  $$ select public.record_financial_entries(gen_random_uuid(), '[]'::jsonb) $$,
  '42501', null, 'usuário não grava lançamentos'
);
reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a9', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select is((select count(*)::int from public.order_reconciliation), 4, 'dono vê a conciliação por tipo');
reset role;

select * from finish();
rollback;
