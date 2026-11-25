create table public.shipment_deadlines (
  order_id uuid primary key references public.orders (id) on delete restrict,
  store_id uuid not null references public.stores (id) on delete restrict,
  sla_status text not null check (sla_status in ('on_time', 'delayed', 'early', 'insuficient_info')),
  expected_at timestamptz,
  alert_level text not null default 'ok' check (alert_level in ('ok', 'warning', 'critical', 'overdue')),
  checked_at timestamptz not null default now()
);

create trigger shipment_deadlines_audit
after insert or update or delete on public.shipment_deadlines
for each row execute function audit.capture_change();

alter table public.shipment_deadlines enable row level security;

revoke all on public.shipment_deadlines from anon, authenticated;
grant select on public.shipment_deadlines to authenticated;

create policy shipment_deadlines_select on public.shipment_deadlines
for select to authenticated
using (private.has_store_role(store_id, array['owner', 'operator']::public.store_role[]));

create function public.dispatch_candidates(p_limit integer)
returns table (
  order_id uuid,
  marketplace_account_id uuid,
  external_id bigint,
  shipping_id bigint,
  alert_level text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.marketplace_account_id, o.external_id, o.shipping_id, coalesce(d.alert_level, 'ok')
  from public.orders o
  left join public.shipment_deadlines d on d.order_id = o.id
  where o.state in ('awaiting_supplier', 'supplier_confirmed', 'ready_to_ship')
    and o.shipping_id is not null
  order by d.checked_at nulls first, o.ordered_at
  limit least(greatest(p_limit, 1), 200);
$$;

create function public.record_shipment_deadline(
  p_order_id uuid,
  p_sla_status text,
  p_expected_at timestamptz,
  p_alert_level text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
begin
  select store_id into v_store_id from public.orders where id = p_order_id;
  if v_store_id is null then
    raise exception 'unknown order' using errcode = 'foreign_key_violation';
  end if;
  insert into public.shipment_deadlines (order_id, store_id, sla_status, expected_at, alert_level, checked_at)
  values (p_order_id, v_store_id, p_sla_status, p_expected_at, p_alert_level, now())
  on conflict (order_id) do update
  set sla_status = excluded.sla_status,
      expected_at = excluded.expected_at,
      alert_level = excluded.alert_level,
      checked_at = excluded.checked_at;
end;
$$;

create function public.record_supplier_update(
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
  select * into v_order from public.purchase_orders where id = p_purchase_order_id for update;
  if not found or not private.has_store_role(v_order.store_id, array['owner', 'operator']::public.store_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_to not in ('confirmed', 'dispatched', 'rejected') then
    raise exception 'only supplier outcomes may be recorded' using errcode = 'check_violation';
  end if;
  if not private.purchase_transition_allowed(v_order.state, p_to) then
    raise exception 'transition % -> % not allowed', v_order.state, p_to using errcode = 'check_violation';
  end if;
  if p_to = 'dispatched' and coalesce(p_tracking_code, v_order.tracking_code) is null then
    raise exception 'tracking code required' using errcode = 'check_violation';
  end if;
  update public.purchase_orders
  set state = p_to,
      supplier_reference = coalesce(nullif(trim(p_supplier_reference), ''), supplier_reference),
      tracking_code = coalesce(nullif(trim(p_tracking_code), ''), tracking_code)
  where id = p_purchase_order_id;
end;
$$;

revoke execute on function public.record_supplier_update(uuid, public.purchase_order_state, text, text) from public, anon;
grant execute on function public.record_supplier_update(uuid, public.purchase_order_state, text, text) to authenticated;

revoke execute on function
  public.dispatch_candidates(integer),
  public.record_shipment_deadline(uuid, text, timestamptz, text)
from public, anon, authenticated;
grant execute on function
  public.dispatch_candidates(integer),
  public.record_shipment_deadline(uuid, text, timestamptz, text)
to service_role;
