begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c9', 'owner-c9@test.local'),
  ('00000000-0000-0000-0000-0000000000d9', 'owner-d9@test.local');
insert into public.stores (id, name) values
  ('10000000-0000-0000-0000-0000000000c9', 'Loja C9'),
  ('10000000-0000-0000-0000-0000000000d9', 'Loja D9');
insert into public.store_members (store_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000c9', 'owner'),
  ('10000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000d9', 'owner');

create temporary table sender as
select public.store_email_credentials('10000000-0000-0000-0000-0000000000c9', 'loja@example.test', 'r') as id;

create function pg_temp.enqueue(p_recipient text, p_status text, p_kind text default 'supplier_prospecting')
returns uuid
language sql
as $$
  select public.enqueue_outbound_message(
    '10000000-0000-0000-0000-0000000000c9', (select id from sender), p_kind, p_recipient,
    'prospecting@1', 'Canto Útil: parceria', 'Olá', p_status
  );
$$;

create temporary table msg as
select pg_temp.enqueue('Comercial@Fornecedor.test', 'awaiting_approval') as a,
       pg_temp.enqueue('vendas@outro.test', 'approved') as b;

select is(
  (select recipient from public.outbound_messages where id = (select a from msg)),
  'comercial@fornecedor.test',
  'destinatário é normalizado'
);

select throws_ok(
  $$ select pg_temp.enqueue('x@y.test', 'sent') $$,
  '22023', null, 'mensagem não nasce enviada'
);
select throws_ok(
  $$ select pg_temp.enqueue('x@y.test', 'approved', 'purchase_order') $$,
  '23514', null, 'pedido de compra exige vínculo com a ordem'
);

update ops.feature_flags set enabled = true where key = 'kill_switch.global';
select is_empty($$ select * from public.claim_outbound_messages(10) $$, 'kill switch impede envio');
update ops.feature_flags set enabled = false where key = 'kill_switch.global';

select results_eq(
  $$ select id, sender_address, attempts::int from public.claim_outbound_messages(10) $$,
  $$ select (select b from msg), 'loja@example.test', 1 $$,
  'somente mensagens aprovadas são reservadas'
);
select is_empty($$ select * from public.claim_outbound_messages(10) $$, 'reserva não se repete');

select public.complete_outbound_message((select b from msg), 'sent', '18c2f0a1b2c3d4e5');
select is(
  (select status || ':' || provider_message_id from public.outbound_messages where id = (select b from msg)),
  'sent:18c2f0a1b2c3d4e5',
  'envio registra o identificador do Gmail'
);
select throws_ok(
  format($$ select public.complete_outbound_message(%L, 'sent', 'x') $$, (select b from msg)),
  '23514', null, 'mensagem enviada não é concluída de novo'
);

select results_eq(
  $$ select previous_contacts, prospecting_today from public.recipient_contact_stats('10000000-0000-0000-0000-0000000000c9', 'VENDAS@outro.test') $$,
  $$ values (1, 1) $$,
  'histórico de contato alimenta a política de envio'
);

create temporary table retry as select pg_temp.enqueue('retry@forn.test', 'approved') as id;
select public.claim_outbound_messages(10);
select public.complete_outbound_message((select id from retry), 'retry', null, 'gmail HTTP 429');
select is(
  (select status from public.outbound_messages where id = (select id from retry)),
  'approved',
  'falha temporária volta para a fila'
);

select public.suppress_email_address('10000000-0000-0000-0000-0000000000c9', 'RETRY@forn.test', 'opt_out');
select is(
  (select status || ':' || decision_reason from public.outbound_messages where id = (select id from retry)),
  'blocked:suppressed',
  'descadastro bloqueia mensagens pendentes'
);
select is(
  (select status from public.outbound_messages where id = pg_temp.enqueue('retry@forn.test', 'approved')),
  'blocked',
  'endereço descadastrado não recebe novas mensagens'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000d9', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select throws_ok(
  format($$ select public.approve_outbound_message(%L) $$, (select a from msg)),
  '42501', null, 'outra loja não aprova a mensagem'
);
select is_empty($$ select id from public.outbound_messages $$, 'outra loja não vê mensagens');
reset role;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c9', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select public.approve_outbound_message((select a from msg));
reset role;
select is(
  (select status || ':' || (approved_by is not null)::text from public.outbound_messages where id = (select a from msg)),
  'approved:true',
  'dona aprova e a aprovação fica registrada'
);

select * from finish();
rollback;
