create type public.financial_entry_kind as enum (
  'revenue', 'sale_fee', 'seller_shipping', 'product_cost', 'supplier_shipping', 'tax', 'refund'
);

create type public.financial_entry_basis as enum ('estimated', 'realized');

create table public.financial_entries (
  id bigint generated always as identity primary key,
  store_id uuid not null references public.stores (id) on delete restrict,
  order_id uuid not null references public.orders (id) on delete restrict,
  kind public.financial_entry_kind not null,
  basis public.financial_entry_basis not null,
  amount numeric(14, 2) not null,
  currency char(3) not null default 'BRL',
  source text not null check (source ~ '^[a-z_]+(:[A-Za-z0-9_-]+)?$'),
  recorded_at timestamptz not null default now(),
  unique (order_id, kind, basis, source)
);

create index financial_entries_store_idx on public.financial_entries (store_id, recorded_at desc);

create trigger financial_entries_immutable
before update or delete on public.financial_entries
for each row execute function private.reject_mutation();

alter table public.financial_entries enable row level security;

revoke all on public.financial_entries from anon, authenticated;
grant select on public.financial_entries to authenticated;
grant select, insert on public.financial_entries to service_role;

create policy financial_entries_select on public.financial_entries
for select to authenticated
using (private.has_store_role(store_id, array['owner', 'finance']::public.store_role[]));

create view public.order_reconciliation
with (security_invoker = true)
as
select
  e.store_id,
  e.order_id,
  e.kind,
  sum(e.amount) filter (where e.basis = 'estimated') as estimated,
  sum(e.amount) filter (where e.basis = 'realized') as realized,
  sum(e.amount) filter (where e.basis = 'realized')
    - sum(e.amount) filter (where e.basis = 'estimated') as divergence
from public.financial_entries e
group by e.store_id, e.order_id, e.kind;

revoke all on public.order_reconciliation from anon, authenticated;
grant select on public.order_reconciliation to authenticated, service_role;

create function public.record_financial_entries(p_order_id uuid, p_entries jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_count integer;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'unknown order' using errcode = 'foreign_key_violation';
  end if;
  if jsonb_typeof(p_entries) <> 'array' then
    raise exception 'entries must be an array' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.financial_entries (store_id, order_id, kind, basis, amount, currency, source)
  select
    v_order.store_id,
    v_order.id,
    (e ->> 'kind')::public.financial_entry_kind,
    (e ->> 'basis')::public.financial_entry_basis,
    (e ->> 'amount_cents')::bigint / 100.0,
    v_order.currency,
    e ->> 'source'
  from jsonb_array_elements(p_entries) e
  on conflict (order_id, kind, basis, source) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.record_financial_entries(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_financial_entries(uuid, jsonb) to service_role;
