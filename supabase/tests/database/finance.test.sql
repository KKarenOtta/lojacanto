begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'owner-f@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'operator-f@test.local');

insert into public.stores (id, name) values ('10000000-0000-0000-0000-00000000000f', 'Loja F');
insert into public.store_members (store_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-0000000000f1', 'owner'),
  ('10000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-0000000000f2', 'operator');

insert into public.marketplace_accounts (id, store_id, channel, seller_id, status) values
  ('30000000-0000-0000-0000-00000000000f', '10000000-0000-0000-0000-00000000000f', 'mercadolivre', 478055420, 'active');

insert into public.suppliers (id, store_id, name) values
  ('40000000-0000-0000-0000-00000000000f', '10000000-0000-0000-0000-00000000000f', 'Fornecedor F');

insert into public.supplier_offers (store_id, supplier_id, external_item_id, priority, unit_cost, shipping_cost, valid_during) values
  ('10000000-0000-0000-0000-00000000000f', '40000000-0000-0000-0000-00000000000f', 'MLB0000000001', 1, 18.00, 3.00, '[2026-11-01,2026-11-20)'),
  ('10000000-0000-0000-0000-00000000000f', '40000000-0000-0000-0000-00000000000f', 'MLB0000000001', 1, 20.00, 3.00, '[2026-11-20,)'),
  ('10000000-0000-0000-0000-00000000000f', '40000000-0000-0000-0000-00000000000f', 'MLB0000000001', 2, 15.00, 5.00, '[2026-11-01,)');

select throws_ok(
  $$ insert into public.supplier_offers (store_id, supplier_id, external_item_id, priority, unit_cost, valid_during)
     values ('10000000-0000-0000-0000-00000000000f', '40000000-0000-0000-0000-00000000000f', 'MLB0000000001', 1, 1, '[2026-11-25,2026-11-26)') $$,
  '23P01',
  null,
  'ofertas de mesma prioridade não se sobrepõem no tempo'
);

insert into public.finance_parameters (store_id, tax_bps, valid_from) values
  ('10000000-0000-0000-0000-00000000000f', 0, '2026-01-01'),
  ('10000000-0000-0000-0000-00000000000f', 600, '2026-12-01');

select public.apply_order_snapshot(
  '30000000-0000-0000-0000-00000000000f',
  jsonb_build_object(
    'external_id', 2000000000000001, 'pack_id', null, 'shipping_id', null, 'status', 'paid',
    'status_detail', null, 'currency', 'BRL', 'total_cents', 10000, 'paid_cents', 10000,
    'is_test', true, 'created_at', '2026-11-21T12:00:00Z', 'closed_at', null,
    'last_updated', '2026-11-21T12:00:00Z',
    'items', jsonb_build_array(
      jsonb_build_object('item_id', 'MLB0000000001', 'variation_id', null, 'title', 'A',
        'quantity', 1, 'unit_price_cents', 5000, 'sale_fee_cents', 700, 'listing_type_id', 'gold_special'),
      jsonb_build_object('item_id', 'MLB0000000002', 'variation_id', null, 'title', 'B',
        'quantity', 1, 'unit_price_cents', 5000, 'sale_fee_cents', 700, 'listing_type_id', 'gold_special')
    )
  ),
  null,
  'awaiting_supplier'
);

create temporary table target as
select id from public.orders where external_id = 2000000000000001;

select is(
  (select count(*)::int from public.cost_snapshots where order_id = (select id from target)),
  2,
  'gravar o pedido captura um snapshot por item'
);
select is(public.capture_cost_snapshots((select id from target)), 0, 'snapshot não é recapturado');
select results_eq(
  $$ select unit_cost, supplier_shipping, tax_bps, sale_fee from public.cost_snapshots
     where order_id = (select id from target) and line = 1 $$,
  $$ values (20.00::numeric, 3.00::numeric, 0, 7.00::numeric) $$,
  'usa a oferta de maior prioridade vigente na data do pedido e o imposto vigente'
);
select is(
  (select unit_cost from public.cost_snapshots where order_id = (select id from target) and line = 2),
  null,
  'item sem oferta fica sem custo'
);

update public.supplier_offers set unit_cost = 99 where external_item_id = 'MLB0000000001' and priority = 1
  and lower(valid_during) = '2026-11-20';
select is(
  (select unit_cost from public.cost_snapshots where order_id = (select id from target) and line = 1),
  20.00::numeric,
  'alteração de custo posterior não muda o snapshot'
);

select throws_ok(
  $$ update public.cost_snapshots set unit_cost = 1 $$,
  '42501',
  null,
  'snapshot não pode ser alterado'
);
select throws_ok(
  $$ delete from public.cost_snapshots $$,
  '42501',
  null,
  'snapshot não pode ser excluído'
);

select is(
  (select count(*)::int from audit.events where entity_type = 'public.supplier_offers' and action = 'update'),
  1,
  'alteração de oferta é auditada'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000f2', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select is_empty($$ select * from public.cost_snapshots $$, 'operador não vê margens');
select isnt_empty($$ select * from public.supplier_offers $$, 'operador vê ofertas de fornecedor');
reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000f1', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select is((select count(*)::int from public.cost_snapshots), 2, 'dono vê os snapshots');
reset role;

select * from finish();
rollback;
