begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e9', 'owner-e9@test.local'),
  ('00000000-0000-0000-0000-0000000000f9', 'owner-f9@test.local');
insert into public.stores (id, name) values
  ('10000000-0000-0000-0000-0000000000e9', 'Loja E9'),
  ('10000000-0000-0000-0000-0000000000f9', 'Loja F9');
insert into public.store_members (store_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000e9', 'owner'),
  ('10000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000f9', 'owner');

select throws_ok(
  $$ insert into public.suppliers (store_id, name, contact_email)
     values ('10000000-0000-0000-0000-0000000000e9', 'Sem fonte', 'a@b.test') $$,
  '23514', null, 'e-mail de contato exige a página onde foi publicado'
);

insert into public.suppliers (id, store_id, name, contact_email, contact_source_url, categories) values
  ('20000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e9', 'Casa Forte',
   'comercial@casaforte.test', 'https://casaforte.test/contato', '{casa,cozinha}'),
  ('20000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-0000000000e9', 'Papel Bom',
   'vendas@papelbom.test', 'https://papelbom.test/atacado', '{escolar}'),
  ('20000000-0000-0000-0000-0000000000e3', '10000000-0000-0000-0000-0000000000e9', 'Sem categoria',
   'x@semcat.test', 'https://semcat.test', '{}');

select is_empty(
  $$ select * from public.prospecting_context('10000000-0000-0000-0000-0000000000e9') $$,
  'sem remetente autorizado não há prospecção'
);

create temporary table sender as
select public.store_email_credentials('10000000-0000-0000-0000-0000000000e9', 'loja@example.test', 'r') as id;

select public.suppress_email_address('10000000-0000-0000-0000-0000000000e9', 'VENDAS@papelbom.test', 'opt_out');

select results_eq(
  $$ select name, suppressed, previous_contacts, pending
     from public.prospecting_candidates('10000000-0000-0000-0000-0000000000e9', 10) order by name $$,
  $$ values ('Casa Forte'::text, false, 0, false), ('Papel Bom'::text, true, 0, false) $$,
  'candidatos trazem descadastro e histórico; sem categoria fica de fora'
);

select public.enqueue_outbound_message(
  '10000000-0000-0000-0000-0000000000e9', (select id from sender), 'supplier_prospecting',
  'comercial@casaforte.test', 'supplier_prospecting@1', 'Assunto', 'Corpo', 'approved',
  null, '20000000-0000-0000-0000-0000000000e1'
);

select results_eq(
  $$ select sender_address, approved_templates, prospecting_today
     from public.prospecting_context('10000000-0000-0000-0000-0000000000e9') $$,
  $$ values ('loja@example.test'::text, '{}'::text[], 1) $$,
  'contexto conta o planejado no dia e lista modelos aprovados'
);

select is(
  (select pending from public.prospecting_candidates('10000000-0000-0000-0000-0000000000e9', 10)
   where name = 'Casa Forte'),
  true,
  'mensagem pendente impede novo planejamento'
);

select public.set_prospect_stage('20000000-0000-0000-0000-0000000000e1', 'replied');
select is(
  (select count(*)::int from public.prospecting_candidates('10000000-0000-0000-0000-0000000000e9', 10)),
  1,
  'fornecedor que respondeu sai da prospecção'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000f9', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select throws_ok(
  $$ select public.approve_message_template('10000000-0000-0000-0000-0000000000e9', 'supplier_prospecting@1') $$,
  '42501', null, 'outra loja não aprova modelos'
);
reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000e9', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select public.approve_message_template('10000000-0000-0000-0000-0000000000e9', 'supplier_prospecting@1');
select is(
  (select template from public.message_template_approvals),
  'supplier_prospecting@1',
  'dona aprova o modelo'
);
select throws_ok(
  $$ select * from public.prospecting_candidates('10000000-0000-0000-0000-0000000000e9', 10) $$,
  '42501', null, 'usuário autenticado não lista candidatos pela função de serviço'
);
reset role;

select * from finish();
rollback;
