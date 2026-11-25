begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'owner-a7@test.local'),
  ('00000000-0000-0000-0000-0000000000b7', 'owner-b7@test.local');
insert into public.stores (id, name) values
  ('10000000-0000-0000-0000-0000000000a7', 'Loja A7'),
  ('10000000-0000-0000-0000-0000000000b7', 'Loja B7');
insert into public.store_members (store_id, user_id, role) values
  ('10000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a7', 'owner'),
  ('10000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000b7', 'owner');

create function pg_temp.rows(p_points integer)
returns jsonb
language sql
as $$
  select jsonb_build_array(
    jsonb_build_object('product_key', 'MLB-organizador', 'title', 'Organizador de gaveta', 'status', 'recommended',
      'total_points', p_points, 'stressed_margin_bps', 2100, 'stressed_contribution_cents', 1678,
      'season_phase', null, 'reasons', '[]'::jsonb),
    jsonb_build_object('product_key', 'MLB-estojo', 'title', 'Estojo escolar', 'status', 'rejected',
      'reasons', '["off_season"]'::jsonb, 'season_phase', 'off_season')
  );
$$;

select is(
  public.record_weekly_selection('10000000-0000-0000-0000-0000000000a7', '2026-11-23', pg_temp.rows(7800)),
  2,
  'seleção da semana é registrada'
);

select is(
  (select stressed_contribution from public.product_recommendations where product_key = 'MLB-organizador'),
  16.78::numeric,
  'contribuição em centavos vira valor monetário'
);

select throws_ok(
  $$ select public.record_weekly_selection('10000000-0000-0000-0000-0000000000a7', '2026-11-24', pg_temp.rows(1)) $$,
  '23514', null, 'semana sempre começa na segunda-feira'
);

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000b7', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select is_empty($$ select id from public.product_recommendations $$, 'outra loja não vê recomendações');
reset role;

create temporary table target as
select id from public.product_recommendations where product_key = 'MLB-organizador';
grant select on target to authenticated;

select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000a7', 'role', 'authenticated', 'aal', 'aal2')::text,
  true
);
set local role authenticated;
select public.decide_recommendation((select id from target), true);
select throws_ok(
  format($$ select public.decide_recommendation(%L, false) $$, (select id from target)),
  '23514', null, 'decisão não é refeita'
);
reset role;

select is(
  (select status || ':' || (decided_by is not null)::text from public.product_recommendations where id = (select id from target)),
  'approved:true',
  'dona aprova e a decisão fica registrada'
);

select public.record_weekly_selection('10000000-0000-0000-0000-0000000000a7', '2026-11-23', pg_temp.rows(100));
select is(
  (select status || ':' || total_points from public.product_recommendations where id = (select id from target)),
  'approved:7800',
  'novo cálculo da semana não altera o que já foi decidido'
);

set local role anon;
select throws_ok(
  $$ select public.record_weekly_selection('10000000-0000-0000-0000-0000000000a7', '2026-11-23', '[]') $$,
  '42501', null, 'anônimo não registra seleção'
);
reset role;

select * from finish();
rollback;
