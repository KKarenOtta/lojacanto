create extension if not exists btree_gist with schema extensions;

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  name text not null check (length(name) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, name)
);

create table public.supplier_offers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  external_item_id text not null check (external_item_id ~ '^MLB\d+$'),
  variation_id bigint,
  priority smallint not null default 1 check (priority > 0),
  unit_cost numeric(14, 2) not null check (unit_cost >= 0),
  shipping_cost numeric(14, 2) not null default 0 check (shipping_cost >= 0),
  currency char(3) not null default 'BRL',
  valid_during tstzrange not null check (not isempty(valid_during) and lower(valid_during) is not null),
  created_at timestamptz not null default now(),
  exclude using gist (
    store_id with =,
    external_item_id with =,
    (coalesce(variation_id, 0)) with =,
    priority with =,
    valid_during with &&
  )
);

create index supplier_offers_supplier_idx on public.supplier_offers (supplier_id);

create table public.finance_parameters (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  tax_bps integer not null check (tax_bps between 0 and 10000),
  valid_from timestamptz not null,
  created_at timestamptz not null default now(),
  unique (store_id, valid_from)
);

create table public.cost_snapshots (
  order_id uuid not null references public.orders (id) on delete restrict,
  line smallint not null check (line > 0),
  store_id uuid not null references public.stores (id) on delete restrict,
  external_item_id text not null,
  variation_id bigint,
  quantity integer not null check (quantity > 0),
  unit_price numeric(14, 2) not null,
  sale_fee numeric(14, 2),
  supplier_offer_id uuid references public.supplier_offers (id) on delete restrict,
  unit_cost numeric(14, 2),
  supplier_shipping numeric(14, 2),
  finance_parameters_id uuid references public.finance_parameters (id) on delete restrict,
  tax_bps integer,
  captured_at timestamptz not null default now(),
  primary key (order_id, line)
);

create index cost_snapshots_store_idx on public.cost_snapshots (store_id, captured_at desc);

create function private.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is immutable', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;

create trigger cost_snapshots_immutable
before update or delete on public.cost_snapshots
for each row execute function private.reject_mutation();

create trigger suppliers_touch_updated_at
before update on public.suppliers
for each row execute function private.touch_updated_at();

create trigger suppliers_audit
after insert or update or delete on public.suppliers
for each row execute function audit.capture_change();

create trigger supplier_offers_audit
after insert or update or delete on public.supplier_offers
for each row execute function audit.capture_change();

create trigger finance_parameters_audit
after insert or update or delete on public.finance_parameters
for each row execute function audit.capture_change();

alter table public.suppliers enable row level security;
alter table public.supplier_offers enable row level security;
alter table public.finance_parameters enable row level security;
alter table public.cost_snapshots enable row level security;

revoke all on public.suppliers, public.supplier_offers, public.finance_parameters, public.cost_snapshots
from anon, authenticated;
grant select on public.suppliers, public.supplier_offers, public.finance_parameters, public.cost_snapshots
to authenticated;
grant all on public.suppliers, public.supplier_offers, public.finance_parameters to service_role;
grant select, insert on public.cost_snapshots to service_role;

create policy suppliers_select on public.suppliers
for select to authenticated
using (private.has_store_role(store_id, enum_range(null::public.store_role)));

create policy supplier_offers_select on public.supplier_offers
for select to authenticated
using (private.has_store_role(store_id, array['owner', 'finance', 'operator']::public.store_role[]));

create policy finance_parameters_select on public.finance_parameters
for select to authenticated
using (private.has_store_role(store_id, array['owner', 'finance']::public.store_role[]));

create policy cost_snapshots_select on public.cost_snapshots
for select to authenticated
using (private.has_store_role(store_id, array['owner', 'finance']::public.store_role[]));

create function public.capture_cost_snapshots(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_parameters public.finance_parameters;
  v_count integer;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'unknown order' using errcode = 'foreign_key_violation';
  end if;

  select * into v_parameters
  from public.finance_parameters p
  where p.store_id = v_order.store_id and p.valid_from <= v_order.ordered_at
  order by p.valid_from desc
  limit 1;

  insert into public.cost_snapshots (
    order_id, line, store_id, external_item_id, variation_id, quantity, unit_price, sale_fee,
    supplier_offer_id, unit_cost, supplier_shipping, finance_parameters_id, tax_bps
  )
  select
    i.order_id, i.line, i.store_id, i.external_item_id, i.variation_id, i.quantity, i.unit_price,
    i.sale_fee, o.id, o.unit_cost, o.shipping_cost, v_parameters.id, v_parameters.tax_bps
  from public.order_items i
  left join lateral (
    select so.id, so.unit_cost, so.shipping_cost
    from public.supplier_offers so
    where so.store_id = i.store_id
      and so.external_item_id = i.external_item_id
      and so.variation_id is not distinct from i.variation_id
      and so.valid_during @> v_order.ordered_at
    order by so.priority
    limit 1
  ) o on true
  where i.order_id = p_order_id
  on conflict (order_id, line) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function private.capture_cost_snapshot_on_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.capture_cost_snapshots(new.order_id);
  return null;
end;
$$;

create trigger order_items_capture_cost
after insert on public.order_items
for each row execute function private.capture_cost_snapshot_on_item();

revoke execute on function public.capture_cost_snapshots(uuid) from public, anon, authenticated;
revoke execute on function private.capture_cost_snapshot_on_item() from public;
grant execute on function public.capture_cost_snapshots(uuid) to service_role;
revoke execute on function private.reject_mutation() from public;
