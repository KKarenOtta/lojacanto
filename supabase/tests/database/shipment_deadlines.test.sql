begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c6', 'owner-s@test.local'),
  ('00000000-0000-0000-0000-0000000000d6', 'other-s@test.local');
insert into public.stores (id, name) values
  ('10000000-0000-0000-0000-0000000000c6', 'Loja S'),
  ('10000000-0000-0000-0000-0000000000d6', 'Loja T');
insert into public.store_members (store_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000c6', '00000000-0000-0000-0000-0000000000c6', 'owner'),
  ('10000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000d6', 'owner');
insert into public.marketplace_accounts (id, store_id, channel, seller_id, status) values
  ('30000000-0000-0000-0000-0000000000c6', '10000000-0000-0000-0000-0000000000c6', 'mercadolivre', 478055426, 'active');
insert into public.suppliers (id, store_id, name, handling_days, accepts_marketplace_label) values
  ('40000000-0000-0000-0000-0000000000c6', '10000000-0000-0000-0000-0000000000c6', 'Fornecedor S', 1, true);

select public.apply_order_snapshot(
  '30000000-0000-0000-0000-0000000000c6',
  jsonb_build_object(
    'external_id', 2000000000000066, 'pack_id', null, 'shipping_id', 43000000066, 'status', 'paid',
    'status_detail', null, 'currency', 'BRL', 'total_cents', 7990, 'paid_cents', 7990,
    'is_test', true, 'created_at', '2026-11-21T12:00:00Z', 'closed_at', null,
    'last_updated', '2026-11-21T12:00:00Z',
    'items', jsonb_build_array(jsonb_build_object('item_id', 'MLB0000000066', 'variation_id', null,
      'title', 'S', 'quantity', 1, 'unit_price_cents', 7990, 'sale_fee_cents', 1119,
      'listing_type_id', 'gold_special'))
  ),
  null,
  'awaiting_supplier'
);

create temporary table target as select id from public.orders where external_id = 2000000000000066;

select results_eq(
  $$ select external_id, alert_level from public.dispatch_candidates(10) $$,
  $$ values (2000000000000066::bigint, 'ok'::text) $$,
  'pedido aguardando despacho entra na verificação de prazo'
);

select public.record_shipment_deadline((select id from target), 'on_time', '2026-11-22T23:59:59Z', 'warning');
select public.record_shipment_deadline((select id from target), 'delayed', '2026-11-22T23:59:59Z', 'overdue');
select is(
  (select sla_status || ':' || alert_level from public.shipment_deadlines),
  'delayed:overdue',
  'última verificação substitui a anterior'
);

insert into public.purchase_orders (id, store_id, order_id, supplier_id, state, total_cost)
select '50000000-0000-0000-0000-0000000000c6', '10000000-0000-0000-0000-0000000000c6', id,
  '40000000-0000-0000-0000-0000000000c6', 'sent', 35.00
from target;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000d6', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select is_empty($$ select order_id from public.shipment_deadlines $$, 'outra loja não vê prazos');
select throws_ok(
  $$ select public.record_supplier_update('50000000-0000-0000-0000-0000000000c6', 'confirmed', 'PV-1') $$,
  '42501', null, 'outra loja não registra retorno do fornecedor'
);
reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c6', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select public.record_supplier_update('50000000-0000-0000-0000-0000000000c6', 'confirmed', ' PV-123 ');
select throws_ok(
  $$ select public.record_supplier_update('50000000-0000-0000-0000-0000000000c6', 'dispatched') $$,
  '23514', null, 'despacho exige código de rastreio'
);
select throws_ok(
  $$ select public.record_supplier_update('50000000-0000-0000-0000-0000000000c6', 'cancelled') $$,
  '23514', null, 'cancelamento não é retorno do fornecedor'
);
select public.record_supplier_update('50000000-0000-0000-0000-0000000000c6', 'dispatched', null, 'BR123456789');
reset role;

select is(
  (select state || ':' || supplier_reference || ':' || tracking_code from public.purchase_orders
   where id = '50000000-0000-0000-0000-0000000000c6'),
  'dispatched:PV-123:BR123456789',
  'confirmação e rastreio ficam registrados'
);

set local role anon;
select throws_ok(
  $$ select public.dispatch_candidates(10) $$,
  '42501', null, 'anônimo não lista pedidos'
);
reset role;

select * from finish();
rollback;
