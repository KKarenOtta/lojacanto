begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c7', 'owner-p@test.local'),
  ('00000000-0000-0000-0000-0000000000d7', 'operator-p@test.local');

insert into public.stores (id, name) values ('10000000-0000-0000-0000-0000000000c7', 'Loja P');
insert into public.store_members (store_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000c7', 'owner'),
  ('10000000-0000-0000-0000-0000000000c7', '00000000-0000-0000-0000-0000000000d7', 'operator');

insert into public.marketplace_accounts (id, store_id, channel, seller_id, status) values
  ('30000000-0000-0000-0000-0000000000c7', '10000000-0000-0000-0000-0000000000c7', 'mercadolivre', 478055422, 'active');

insert into public.suppliers (id, store_id, name, handling_days, accepts_marketplace_label) values
  ('40000000-0000-0000-0000-0000000000c7', '10000000-0000-0000-0000-0000000000c7', 'Fornecedor P', 1, true);

select public.apply_order_snapshot(
  '30000000-0000-0000-0000-0000000000c7',
  jsonb_build_object(
    'external_id', 2000000000000077, 'pack_id', null, 'shipping_id', null, 'status', 'paid',
    'status_detail', null, 'currency', 'BRL', 'total_cents', 7990, 'paid_cents', 7990,
    'is_test', true, 'created_at', '2026-11-21T12:00:00Z', 'closed_at', null,
    'last_updated', '2026-11-21T12:00:00Z',
    'items', jsonb_build_array(jsonb_build_object('item_id', 'MLB0000000077', 'variation_id', null,
      'title', 'P', 'quantity', 1, 'unit_price_cents', 7990, 'sale_fee_cents', 1119,
      'listing_type_id', 'gold_special'))
  ),
  null,
  'awaiting_supplier'
);

insert into public.purchase_orders (id, store_id, order_id, supplier_id, state, total_cost)
select '50000000-0000-0000-0000-0000000000c7', '10000000-0000-0000-0000-0000000000c7', id,
  '40000000-0000-0000-0000-0000000000c7', 'awaiting_approval', 35.00
from public.orders where external_id = 2000000000000077;

select throws_ok(
  $$ insert into public.purchase_orders (store_id, order_id, supplier_id, total_cost)
     select store_id, order_id, supplier_id, 1 from public.purchase_orders $$,
  '23505', null, 'um único pedido de compra ativo por venda'
);

select throws_ok(
  $$ select public.transition_purchase_order('50000000-0000-0000-0000-0000000000c7', 'sent') $$,
  '42501', null, 'envio ao fornecedor exige aprovação'
);
select throws_ok(
  $$ select public.transition_purchase_order('50000000-0000-0000-0000-0000000000c7', 'dispatched') $$,
  '23514', null, 'transição fora da máquina de estados é recusada'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000d7', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select throws_ok(
  $$ select public.approve_purchase_order('50000000-0000-0000-0000-0000000000c7') $$,
  '42501', null, 'operador não aprova compra'
);
select isnt_empty($$ select * from public.purchase_orders $$, 'operador acompanha os pedidos de compra');
select throws_ok(
  $$ select public.transition_purchase_order('50000000-0000-0000-0000-0000000000c7', 'cancelled') $$,
  '42501', null, 'usuário não altera estado diretamente'
);
reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c7', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select lives_ok(
  $$ select public.approve_purchase_order('50000000-0000-0000-0000-0000000000c7') $$,
  'dono aprova a compra'
);
reset role;

update ops.feature_flags set enabled = true where key = 'kill_switch.global';
select throws_ok(
  $$ select public.transition_purchase_order('50000000-0000-0000-0000-0000000000c7', 'sent') $$,
  '57000', null, 'kill switch bloqueia o envio'
);
update ops.feature_flags set enabled = false where key = 'kill_switch.global';

select public.transition_purchase_order('50000000-0000-0000-0000-0000000000c7', 'sent', 'PED-123');
select is(
  (select state::text || ':' || supplier_reference from public.purchase_orders),
  'sent:PED-123',
  'compra aprovada é enviada com referência do fornecedor'
);
select is(
  (select actor_id from audit.events
   where entity_type = 'public.purchase_orders' and action = 'update'
     and after ->> 'approved_by' is not null
   order by seq limit 1),
  '00000000-0000-0000-0000-0000000000c7',
  'aprovação fica auditada com o autor'
);

select * from finish();
rollback;
