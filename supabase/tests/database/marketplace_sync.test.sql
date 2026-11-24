begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'owner-d@test.local'),
  ('00000000-0000-0000-0000-0000000000e1', 'owner-e@test.local');

insert into public.stores (id, name) values
  ('10000000-0000-0000-0000-00000000000d', 'Loja D'),
  ('10000000-0000-0000-0000-00000000000e', 'Loja E');

insert into public.store_members (store_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-0000000000d1', 'owner'),
  ('10000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-0000000000e1', 'owner');

insert into public.marketplace_accounts (id, store_id, channel, seller_id, status) values
  ('30000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-00000000000d', 'mercadolivre', 478055419, 'active');

create function pg_temp.snapshot(p_status text, p_updated text, p_quantity integer)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'external_id', 2000003508897196, 'pack_id', null, 'shipping_id', 40000000001,
    'status', p_status, 'status_detail', null, 'currency', 'BRL',
    'total_cents', 5000 * p_quantity, 'paid_cents', 5000 * p_quantity, 'is_test', true,
    'created_at', '2026-11-20T10:00:00Z', 'closed_at', '2026-11-20T10:01:00Z',
    'last_updated', p_updated,
    'items', jsonb_build_array(jsonb_build_object(
      'item_id', 'MLB0000000001', 'variation_id', null, 'title', 'Organizador de gaveta',
      'quantity', p_quantity, 'unit_price_cents', 5000, 'sale_fee_cents', 1200,
      'listing_type_id', 'gold_special'
    ))
  );
$$;

select is(
  (select count(*)::int from generate_series(1, 100) g
   where public.enqueue_marketplace_notification(
     'orders_v2', '/orders/2000003508897196', 478055419, 5503910054141466, g,
     '2026-11-20T10:01:00Z', gen_random_uuid()
   )),
  1,
  '100 notificações iguais geram um único evento pendente'
);
select is(
  (select count(*)::int from ops.integration_events where resource = '/orders/2000003508897196'),
  1,
  'evento duplicado não é gravado'
);
select is(
  (select count(*)::int from pgmq.q_ml_notifications),
  1,
  'uma única mensagem é enfileirada'
);

create temporary table claimed as
select * from public.claim_marketplace_notifications(10, 30);

select is((select count(*)::int from claimed), 1, 'worker recebe o evento');
select is(
  (select marketplace_account_id from claimed),
  '30000000-0000-0000-0000-00000000000d'::uuid,
  'evento é associado à conta ativa do vendedor'
);
select is(
  (select status from ops.integration_events where id = (select event_id from claimed)),
  'processing',
  'evento recebido fica em processamento'
);
select ok(
  public.enqueue_marketplace_notification(
    'orders_v2', '/orders/2000003508897196', 478055419, 5503910054141466, 1,
    '2026-11-20T10:05:00Z', gen_random_uuid()
  ),
  'notificação nova durante o processamento é aceita'
);

select public.complete_marketplace_notification(
  (select msg_id from claimed), (select event_id from claimed), 'processed'
);
select is(
  (select status from ops.integration_events where id = (select event_id from claimed)),
  'processed',
  'evento concluído é marcado como processado'
);
select is(
  (select count(*)::int from pgmq.q_ml_notifications where msg_id = (select msg_id from claimed)),
  0,
  'mensagem concluída sai da fila'
);

select is(
  public.apply_order_snapshot(
    '30000000-0000-0000-0000-00000000000d', pg_temp.snapshot('paid', '2026-11-20T10:02:00Z', 1),
    null, 'awaiting_supplier'
  ),
  'inserted',
  'pedido novo é inserido'
);
select is(
  (select total_amount from public.orders where external_id = 2000003508897196),
  50.00::numeric,
  'centavos são convertidos sem perda'
);
select is(
  public.apply_order_snapshot(
    '30000000-0000-0000-0000-00000000000d', pg_temp.snapshot('cancelled', '2026-11-20T10:02:00Z', 1),
    'awaiting_supplier', 'cancelled'
  ),
  'stale',
  'versão com o mesmo last_updated é ignorada'
);
select is(
  public.apply_order_snapshot(
    '30000000-0000-0000-0000-00000000000d', pg_temp.snapshot('cancelled', '2026-11-20T09:00:00Z', 1),
    'awaiting_supplier', 'cancelled'
  ),
  'stale',
  'evento fora de ordem não regride o pedido'
);
select is(
  public.apply_order_snapshot(
    '30000000-0000-0000-0000-00000000000d', pg_temp.snapshot('paid', '2026-11-20T11:00:00Z', 2),
    'received', 'awaiting_supplier'
  ),
  'conflict',
  'estado esperado divergente é recusado'
);
select is(
  public.apply_order_snapshot(
    '30000000-0000-0000-0000-00000000000d', pg_temp.snapshot('paid', '2026-11-20T11:00:00Z', 2),
    'awaiting_supplier', 'awaiting_supplier'
  ),
  'updated',
  'versão mais nova atualiza o pedido'
);
select results_eq(
  $$ select line::int, quantity from public.order_items
     where order_id = (select id from public.orders where external_id = 2000003508897196) $$,
  $$ values (1, 2) $$,
  'itens são substituídos pela versão mais nova'
);

select public.store_marketplace_tokens(
  '30000000-0000-0000-0000-00000000000d', 'APP_USR-access-fixture', 'TG-refresh-fixture',
  '2026-11-20T16:00:00Z'
);
select results_eq(
  $$ select access_token, refresh_token from public.read_marketplace_tokens('30000000-0000-0000-0000-00000000000d') $$,
  $$ values ('APP_USR-access-fixture', 'TG-refresh-fixture') $$,
  'tokens são gravados e lidos pelo cofre'
);
select is(
  (select count(*)::int from private.marketplace_tokens t
   join vault.secrets s on s.id = t.access_token_secret_id
   where s.secret = 'APP_USR-access-fixture'),
  0,
  'token não fica em texto puro'
);
select ok(
  public.acquire_token_refresh_lease('30000000-0000-0000-0000-00000000000d', 30)
  and not public.acquire_token_refresh_lease('30000000-0000-0000-0000-00000000000d', 30),
  'apenas um worker obtém a renovação do token'
);

select is(public.kill_switch_active(), false, 'kill switch desligado permite processamento');

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000e1', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select is_empty($$ select id from public.orders $$, 'outra loja não vê o pedido');
select throws_ok(
  $$ select public.read_marketplace_tokens('30000000-0000-0000-0000-00000000000d') $$,
  '42501',
  null,
  'usuário autenticado não lê tokens'
);
reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select is(
  (select count(*)::int from public.orders),
  1,
  'dono da loja vê o próprio pedido'
);
reset role;

set local role anon;
select throws_ok(
  $$ select public.enqueue_marketplace_notification('orders_v2', '/orders/1', 1, 1, 1, now(), gen_random_uuid()) $$,
  '42501',
  null,
  'anônimo não enfileira notificações'
);
reset role;

select * from finish();
rollback;
