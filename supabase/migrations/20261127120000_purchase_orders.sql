alter table public.suppliers
  add column order_channel text not null default 'manual'
    check (order_channel in ('manual', 'email', 'api')),
  add column handling_days smallint check (handling_days between 0 and 30),
  add column accepts_marketplace_label boolean not null default false,
  add column issues_invoice boolean not null default false,
  add column neutral_packaging boolean not null default false,
  add column return_policy boolean not null default false,
  add column test_order_approved_at timestamptz;

create type public.purchase_order_state as enum (
  'draft', 'awaiting_approval', 'sent', 'confirmed', 'dispatched', 'rejected', 'cancelled'
);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  order_id uuid not null references public.orders (id) on delete restrict,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  state public.purchase_order_state not null default 'draft',
  total_cost numeric(14, 2) not null check (total_cost >= 0),
  approved_by uuid references auth.users (id) on delete restrict,
  approved_at timestamptz,
  supplier_reference text check (length(supplier_reference) <= 80),
  tracking_code text check (length(tracking_code) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null))
);

create unique index purchase_orders_active_order_idx
on public.purchase_orders (order_id)
where state not in ('rejected', 'cancelled');

create index purchase_orders_store_state_idx on public.purchase_orders (store_id, state);

create trigger purchase_orders_touch_updated_at
before update on public.purchase_orders
for each row execute function private.touch_updated_at();

create trigger purchase_orders_audit
after insert or update or delete on public.purchase_orders
for each row execute function audit.capture_change();

alter table public.purchase_orders enable row level security;

revoke all on public.purchase_orders from anon, authenticated;
grant select on public.purchase_orders to authenticated;
grant select, insert on public.purchase_orders to service_role;

create policy purchase_orders_select on public.purchase_orders
for select to authenticated
using (private.has_store_role(store_id, array['owner', 'finance', 'operator']::public.store_role[]));

create function private.purchase_transition_allowed(
  p_from public.purchase_order_state,
  p_to public.purchase_order_state
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('draft', 'awaiting_approval'), ('draft', 'cancelled'),
    ('awaiting_approval', 'sent'), ('awaiting_approval', 'cancelled'),
    ('sent', 'confirmed'), ('sent', 'rejected'), ('sent', 'cancelled'),
    ('confirmed', 'dispatched'), ('confirmed', 'cancelled')
  );
$$;

create function public.approve_purchase_order(p_purchase_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
  v_user uuid := auth.uid();
begin
  select * into v_order from public.purchase_orders where id = p_purchase_order_id for update;
  if not found or not private.has_store_role(v_order.store_id, array['owner']::public.store_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_order.state <> 'awaiting_approval' then
    raise exception 'purchase order is %', v_order.state using errcode = 'check_violation';
  end if;
  update public.purchase_orders
  set approved_by = v_user, approved_at = now()
  where id = p_purchase_order_id;
end;
$$;

create function public.transition_purchase_order(
  p_purchase_order_id uuid,
  p_to public.purchase_order_state,
  p_supplier_reference text default null,
  p_tracking_code text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.purchase_orders;
begin
  if (select enabled from ops.feature_flags where key = 'kill_switch.global') is distinct from false then
    raise exception 'kill switch active' using errcode = 'operator_intervention';
  end if;
  select * into v_order from public.purchase_orders where id = p_purchase_order_id for update;
  if not found then
    raise exception 'unknown purchase order' using errcode = 'foreign_key_violation';
  end if;
  if not private.purchase_transition_allowed(v_order.state, p_to) then
    raise exception 'transition % -> % not allowed', v_order.state, p_to using errcode = 'check_violation';
  end if;
  if p_to = 'sent' and v_order.approved_at is null then
    raise exception 'approval required' using errcode = 'insufficient_privilege';
  end if;
  update public.purchase_orders
  set state = p_to,
      supplier_reference = coalesce(p_supplier_reference, supplier_reference),
      tracking_code = coalesce(p_tracking_code, tracking_code)
  where id = p_purchase_order_id;
end;
$$;

revoke execute on function private.purchase_transition_allowed(public.purchase_order_state, public.purchase_order_state) from public;
revoke execute on function public.approve_purchase_order(uuid) from public, anon;
grant execute on function public.approve_purchase_order(uuid) to authenticated;
revoke execute on function public.transition_purchase_order(uuid, public.purchase_order_state, text, text)
from public, anon, authenticated;
grant execute on function public.transition_purchase_order(uuid, public.purchase_order_state, text, text)
to service_role;
