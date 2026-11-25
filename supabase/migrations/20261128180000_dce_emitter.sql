alter table public.marketplace_accounts
  add column dce_emitter text not null default 'pulso' check (dce_emitter in ('pulso', 'platform'));

drop function public.dce_candidates(integer);

create function public.dce_candidates(p_limit integer)
returns table (
  order_id uuid,
  marketplace_account_id uuid,
  external_id bigint,
  ordered_at timestamptz,
  status text,
  alert_level text,
  emitter text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.marketplace_account_id, o.external_id, o.ordered_at, d.status,
    coalesce(d.alert_level, 'ok'), a.dce_emitter
  from public.orders o
  join public.marketplace_accounts a on a.id = o.marketplace_account_id
  left join public.fiscal_documents d on d.order_id = o.id
  where a.fiscal_profile in ('individual', 'company_non_taxpayer')
    and o.state in ('awaiting_supplier', 'supplier_confirmed', 'ready_to_ship')
    and o.shipping_id is not null
    and (d.status is null or d.status <> 'completed')
  order by o.ordered_at
  limit p_limit;
$$;

revoke execute on function public.dce_candidates(integer) from public, anon, authenticated;
grant execute on function public.dce_candidates(integer) to service_role;
