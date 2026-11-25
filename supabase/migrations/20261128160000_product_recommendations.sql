create table public.product_recommendations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  week date not null check (extract(isodow from week) = 1),
  product_key text not null check (length(product_key) between 1 and 80),
  title text not null check (length(title) between 1 and 200),
  supplier_id uuid references public.suppliers (id) on delete restrict,
  season_phase text check (season_phase in ('in_season', 'lead', 'off_season')),
  total_points integer check (total_points >= 0),
  stressed_margin_bps integer,
  stressed_contribution numeric(14,2),
  reasons text[] not null default '{}',
  status text not null check (status in ('recommended', 'deferred', 'rejected', 'approved', 'declined')),
  decided_by uuid references auth.users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, week, product_key),
  check ((status in ('approved', 'declined')) = (decided_at is not null and decided_by is not null)),
  check ((status = 'rejected') = (cardinality(reasons) > 0))
);

create index product_recommendations_open_idx on public.product_recommendations (store_id, week)
where status = 'recommended';

create trigger product_recommendations_touch_updated_at
before update on public.product_recommendations
for each row execute function private.touch_updated_at();

create trigger product_recommendations_audit
after insert or update or delete on public.product_recommendations
for each row execute function audit.capture_change();

alter table public.product_recommendations enable row level security;

revoke all on public.product_recommendations from anon, authenticated;
grant select on public.product_recommendations to authenticated;

create policy product_recommendations_select on public.product_recommendations
for select to authenticated
using (private.has_store_role(store_id, array['owner', 'operator']::public.store_role[]));

create function public.record_weekly_selection(p_store_id uuid, p_week date, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be an array' using errcode = '22023';
  end if;

  insert into public.product_recommendations (
    store_id, week, product_key, title, supplier_id, season_phase, total_points,
    stressed_margin_bps, stressed_contribution, reasons, status
  )
  select p_store_id, p_week, r ->> 'product_key', r ->> 'title', (r ->> 'supplier_id')::uuid,
    r ->> 'season_phase', (r ->> 'total_points')::integer, (r ->> 'stressed_margin_bps')::integer,
    (r ->> 'stressed_contribution_cents')::numeric / 100,
    coalesce(array(select jsonb_array_elements_text(r -> 'reasons')), '{}'),
    r ->> 'status'
  from jsonb_array_elements(p_rows) as r
  where r ->> 'status' in ('recommended', 'deferred', 'rejected')
  on conflict (store_id, week, product_key) do update
  set title = excluded.title,
      supplier_id = excluded.supplier_id,
      season_phase = excluded.season_phase,
      total_points = excluded.total_points,
      stressed_margin_bps = excluded.stressed_margin_bps,
      stressed_contribution = excluded.stressed_contribution,
      reasons = excluded.reasons,
      status = excluded.status
  where public.product_recommendations.status not in ('approved', 'declined');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.decide_recommendation(p_recommendation_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.product_recommendations;
begin
  select * into v_row from public.product_recommendations where id = p_recommendation_id for update;
  if not found or not private.has_store_role(v_row.store_id, array['owner']::public.store_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_row.status <> 'recommended' then
    raise exception 'recommendation is %', v_row.status using errcode = 'check_violation';
  end if;
  update public.product_recommendations
  set status = case when p_approve then 'approved' else 'declined' end,
      decided_by = auth.uid(),
      decided_at = now()
  where id = p_recommendation_id;
end;
$$;

revoke execute on function public.decide_recommendation(uuid, boolean) from public, anon;
grant execute on function public.decide_recommendation(uuid, boolean) to authenticated;

revoke execute on function public.record_weekly_selection(uuid, date, jsonb)
from public, anon, authenticated;
grant execute on function public.record_weekly_selection(uuid, date, jsonb) to service_role;
