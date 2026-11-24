begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

insert into public.stores (id, name) values ('10000000-0000-0000-0000-0000000000e8', 'Loja Q');
insert into public.marketplace_accounts (id, store_id, channel, seller_id, status, fiscal_profile) values
  ('30000000-0000-0000-0000-0000000000e8', '10000000-0000-0000-0000-0000000000e8', 'mercadolivre', 478055423, 'active', 'individual'),
  ('30000000-0000-0000-0000-0000000000f8', '10000000-0000-0000-0000-0000000000e8', 'mercadolivre', 478055424, 'active', 'company_taxpayer');

create function pg_temp.order_json(p_id bigint, p_shipping bigint)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'external_id', p_id, 'pack_id', null, 'shipping_id', p_shipping, 'status', 'paid',
    'status_detail', null, 'currency', 'BRL', 'total_cents', 1000, 'paid_cents', 1000,
    'is_test', true, 'created_at', '2026-12-01T12:00:00Z', 'closed_at', null,
    'last_updated', '2026-12-01T12:00:00Z',
    'items', jsonb_build_array(jsonb_build_object('item_id', 'MLB1', 'variation_id', null,
      'title', 'Q', 'quantity', 1, 'unit_price_cents', 1000, 'sale_fee_cents', 100,
      'listing_type_id', 'gold_special'))
  );
$$;

select public.apply_order_snapshot('30000000-0000-0000-0000-0000000000e8', pg_temp.order_json(3000000000000001, 41), null, 'awaiting_supplier');
select public.apply_order_snapshot('30000000-0000-0000-0000-0000000000e8', pg_temp.order_json(3000000000000002, null), null, 'awaiting_supplier');
select public.apply_order_snapshot('30000000-0000-0000-0000-0000000000f8', pg_temp.order_json(3000000000000003, 43), null, 'awaiting_supplier');

select results_eq(
  $$ select external_id from public.dce_candidates(10) $$,
  $$ values (3000000000000001::bigint) $$,
  'só pedidos com envio de conta pessoa física precisam de DC-e'
);

create temporary table target as select id from public.orders where external_id = 3000000000000001;

select public.record_fiscal_document((select id from target), 'requested', '94e95c5fc1356f8e4c2bf779dce40000');
select is(
  (select status || ':' || coverage_id from public.fiscal_documents),
  'requested:94e95c5fc1356f8e4c2bf779dce40000',
  'solicitação de emissão é registrada'
);

select public.record_fiscal_document((select id from target), 'pending', null, null, null, 'warning');
select is(
  (select coverage_id || ':' || alert_level from public.fiscal_documents),
  '94e95c5fc1356f8e4c2bf779dce40000:warning',
  'atualização preserva a cobertura e registra o nível do alerta'
);

select public.record_fiscal_document((select id from target), 'completed', null, 'doc-789');
select is_empty($$ select * from public.dce_candidates(10) $$, 'DC-e concluída sai da lista');

select public.record_fiscal_document((select id from target), 'error', null, null, 'E1');
select is(
  (select status from public.fiscal_documents), 'completed', 'documento concluído não volta atrás'
);

select is(
  (select count(*)::int from audit.events where entity_type = 'public.fiscal_documents'),
  3,
  'cada mudança efetiva do documento é auditada'
);

set local role anon;
select throws_ok(
  $$ select public.dce_candidates(1) $$, '42501', null, 'anônimo não consulta pendências fiscais'
);
reset role;

select * from finish();
rollback;
