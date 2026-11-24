begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner-a@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner-b@test.local'),
  ('00000000-0000-0000-0000-0000000000a2', 'viewer-a@test.local'),
  ('00000000-0000-0000-0000-0000000000a3', 'new-a@test.local');

insert into public.stores (id, name) values
  ('10000000-0000-0000-0000-00000000000a', 'Loja A'),
  ('10000000-0000-0000-0000-00000000000b', 'Loja B');

insert into public.store_members (store_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'owner'),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'owner'),
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'viewer');

create function pg_temp.act_as(p_user uuid, p_aal text)
returns void
language sql
as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text,
    true
  );
$$;

set local role authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'aal2');
select results_eq(
  $$ select id from public.stores $$,
  $$ values ('10000000-0000-0000-0000-00000000000a'::uuid) $$,
  'membro vê apenas a própria loja'
);
select is(
  (select count(*)::int from public.store_members),
  2,
  'membro vê apenas membros da própria loja'
);
select isnt_empty(
  $$ update public.stores set name = 'Loja A2' where id = '10000000-0000-0000-0000-00000000000a' returning id $$,
  'owner altera a própria loja'
);
select is_empty(
  $$ update public.stores set name = 'Invasão' where id = '10000000-0000-0000-0000-00000000000b' returning id $$,
  'owner não altera loja de outro'
);
select lives_ok(
  $$ insert into public.store_members (store_id, user_id, role)
     values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a3', 'operator') $$,
  'owner adiciona membro à própria loja'
);
select throws_ok(
  $$ insert into public.store_members (store_id, user_id, role)
     values ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a3', 'owner') $$,
  '42501',
  null,
  'owner não adiciona membro em loja de outro'
);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', 'aal1');
select is_empty($$ select id from public.stores $$, 'sem MFA (aal1) nenhuma loja é visível');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2', 'aal2');
select is(
  (select count(*)::int from public.stores),
  1,
  'viewer vê a loja'
);
select is_empty(
  $$ update public.stores set name = 'Alterada' where id = '10000000-0000-0000-0000-00000000000a' returning id $$,
  'viewer não altera a loja'
);
select throws_ok(
  $$ insert into public.store_members (store_id, user_id, role)
     values ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'owner') $$,
  '42501',
  null,
  'viewer não se promove a owner'
);
select is_empty(
  $$ update public.store_members set role = 'owner'
     where user_id = '00000000-0000-0000-0000-0000000000a2' returning user_id $$,
  'viewer não altera o próprio papel'
);

select throws_ok($$ select * from audit.events $$, '42501', null, 'usuário não acessa audit.events');
select throws_ok($$ select * from ops.feature_flags $$, '42501', null, 'usuário não acessa ops.feature_flags');

reset role;
set local role anon;
select throws_ok($$ select * from public.stores $$, '42501', null, 'anônimo não acessa lojas');

reset role;
select * from finish();
rollback;
