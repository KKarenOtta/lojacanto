begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'owner-c@test.local');

select set_config('app.correlation_id', '20000000-0000-0000-0000-000000000001', true);
insert into public.stores (id, name) values ('10000000-0000-0000-0000-00000000000c', 'Loja C');
insert into public.store_members (store_id, user_id, role)
values ('10000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000c1', 'owner');

select is(
  (select count(*)::int from audit.events
   where entity_type = 'public.stores' and action = 'insert'
     and entity_id = '10000000-0000-0000-0000-00000000000c'),
  1,
  'criação de loja é auditada'
);
select is(
  (select actor_type from audit.events
   where entity_type = 'public.stores' and entity_id = '10000000-0000-0000-0000-00000000000c'),
  'service',
  'escrita sem usuário é atribuída a serviço'
);
select is(
  (select count(*)::int from audit.events where correlation_id = '20000000-0000-0000-0000-000000000001'),
  2,
  'correlation_id da transação é propagado'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c1', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
update public.stores set name = 'Loja C2' where id = '10000000-0000-0000-0000-00000000000c';
reset role;

select results_eq(
  $$ select actor_type, actor_id, before ->> 'name', after ->> 'name'
     from audit.events
     where entity_type = 'public.stores' and action = 'update'
       and entity_id = '10000000-0000-0000-0000-00000000000c' $$,
  $$ values ('user'::text, '00000000-0000-0000-0000-0000000000c1'::text, 'Loja C'::text, 'Loja C2'::text) $$,
  'alteração por usuário registra autor e antes/depois'
);

select is(
  (select e.prev_hash from audit.events e order by e.seq desc limit 1),
  (select e.hash from audit.events e order by e.seq desc offset 1 limit 1),
  'cada evento referencia o hash do anterior'
);
select is(audit.verify_chain(), null::bigint, 'cadeia íntegra');
select isnt(
  (select audit.compute_hash(e) from audit.events e order by e.seq desc limit 1),
  (select audit.compute_hash(jsonb_populate_record(e, '{"after": {"name": "Forjado"}}'::jsonb))
   from audit.events e order by e.seq desc limit 1),
  'alterar conteúdo muda o hash'
);

select throws_ok($$ update audit.events set action = 'x' $$, '42501', 'audit.events is append-only', 'UPDATE é rejeitado');
select throws_ok($$ delete from audit.events $$, '42501', 'audit.events is append-only', 'DELETE é rejeitado');
select throws_ok($$ truncate audit.events $$, '42501', 'audit.events is append-only', 'TRUNCATE é rejeitado');

set local role service_role;
select throws_ok($$ update audit.events set action = 'x' $$, '42501', null, 'service_role não altera auditoria');
reset role;

select is(
  (select enabled from ops.feature_flags where key = 'kill_switch.global'),
  false,
  'kill switch global inicia desligado'
);

select * from finish();
rollback;
