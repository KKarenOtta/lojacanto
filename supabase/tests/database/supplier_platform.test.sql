begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(4);

insert into public.stores (id, name) values ('10000000-0000-0000-0000-0000000000a8', 'Loja A8');

select lives_ok(
  $$ insert into public.suppliers (store_id, name, order_channel, platform_name, cutoff_hour, handling_days)
     values ('10000000-0000-0000-0000-0000000000a8', 'Silkdrop', 'platform', 'Silkdrop', 13, 0) $$,
  'fornecedor de plataforma registra nome e horário de corte'
);

select throws_ok(
  $$ insert into public.suppliers (store_id, name, order_channel)
     values ('10000000-0000-0000-0000-0000000000a8', 'Sem nome', 'platform') $$,
  '23514', null, 'canal de plataforma exige o nome da plataforma'
);

select throws_ok(
  $$ insert into public.suppliers (store_id, name, order_channel, cutoff_hour)
     values ('10000000-0000-0000-0000-0000000000a8', 'Corte inválido', 'manual', 24) $$,
  '23514', null, 'horário de corte fica entre 0 e 23'
);

select throws_ok(
  $$ insert into public.marketplace_accounts (store_id, channel, seller_id, dce_emitter)
     values ('10000000-0000-0000-0000-0000000000a8', 'mercadolivre', 478055499, 'fornecedor') $$,
  '23514', null, 'emissor da DC-e é o Pulso ou a plataforma'
);

select * from finish();
rollback;
