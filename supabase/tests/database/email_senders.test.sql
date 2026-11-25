begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'owner-a9@test.local'),
  ('00000000-0000-0000-0000-0000000000b9', 'owner-b9@test.local');

insert into public.stores (id, name) values
  ('10000000-0000-0000-0000-0000000000a9', 'Loja A9'),
  ('10000000-0000-0000-0000-0000000000b9', 'Loja B9');

insert into public.store_members (store_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000a9', 'owner'),
  ('10000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000b9', 'owner');

create temporary table sender as
select public.store_email_credentials(
  '10000000-0000-0000-0000-0000000000a9', 'Loja@Example.test', 'refresh-fixture-1'
) as id;

select results_eq(
  $$ select refresh_token from public.read_email_credentials('10000000-0000-0000-0000-0000000000a9', 'loja@example.test') $$,
  $$ values ('refresh-fixture-1') $$,
  'credencial é gravada no cofre e lida pelo endereço normalizado'
);

select is(
  (select count(*)::int from private.email_credentials c
   join vault.secrets s on s.id = c.refresh_token_secret_id
   where s.secret = 'refresh-fixture-1'),
  0,
  'token não fica em texto puro'
);

select is(
  public.store_email_credentials('10000000-0000-0000-0000-0000000000a9', 'loja@example.test', 'refresh-fixture-2'),
  (select id from sender),
  'reautorização reaproveita o remetente'
);

select results_eq(
  $$ select refresh_token from public.read_email_credentials('10000000-0000-0000-0000-0000000000a9', 'loja@example.test') $$,
  $$ values ('refresh-fixture-2') $$,
  'reautorização substitui o token'
);

select throws_ok(
  $$ select public.store_email_credentials('10000000-0000-0000-0000-0000000000a9', 'loja@example.test', '') $$,
  '22023',
  null,
  'token vazio é recusado'
);

select public.mark_email_reauthorization_required((select id from sender));
select is_empty(
  $$ select * from public.read_email_credentials('10000000-0000-0000-0000-0000000000a9', 'loja@example.test') $$,
  'remetente com reautorização pendente não entrega credencial'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000b9', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select is_empty($$ select id from public.email_senders $$, 'outra loja não vê o remetente');
select throws_ok(
  $$ select * from public.read_email_credentials('10000000-0000-0000-0000-0000000000a9', 'loja@example.test') $$,
  '42501',
  null,
  'usuário autenticado não lê credenciais'
);
reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a9', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select is(
  (select status from public.email_senders),
  'reauthorization_required',
  'dona vê o estado do remetente'
);
reset role;

select * from finish();
rollback;
