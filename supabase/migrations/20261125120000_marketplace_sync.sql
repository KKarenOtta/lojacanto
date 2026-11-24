create extension if not exists pgmq;

select pgmq.create('ml_notifications');
select pgmq.create('ml_notifications_dlq');

create type public.marketplace_account_status as enum (
  'pending', 'active', 'reauthorization_required', 'revoked'
);

create type public.order_state as enum (
  'received', 'awaiting_supplier', 'supplier_confirmed', 'ready_to_ship',
  'shipped', 'delivered', 'problem', 'cancelled', 'returned'
);

create table public.marketplace_accounts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  channel text not null check (channel = 'mercadolivre'),
  seller_id bigint not null check (seller_id > 0),
  status public.marketplace_account_status not null default 'pending',
  access_token_expires_at timestamptz,
  refresh_lease_until timestamptz,
  last_reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, seller_id)
);

create index marketplace_accounts_store_id_idx on public.marketplace_accounts (store_id);

create trigger marketplace_accounts_touch_updated_at
before update on public.marketplace_accounts
for each row execute function private.touch_updated_at();

create trigger marketplace_accounts_audit
after insert or update or delete on public.marketplace_accounts
for each row execute function audit.capture_change();

create table private.marketplace_tokens (
  marketplace_account_id uuid primary key references public.marketplace_accounts (id) on delete cascade,
  access_token_secret_id uuid not null,
  refresh_token_secret_id uuid not null,
  updated_at timestamptz not null default now()
);

alter table private.marketplace_tokens enable row level security;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  marketplace_account_id uuid not null references public.marketplace_accounts (id) on delete restrict,
  external_id bigint not null,
  pack_id bigint,
  shipping_id bigint,
  external_status text not null check (external_status in (
    'confirmed', 'payment_required', 'payment_in_process', 'partially_paid', 'paid',
    'partially_refunded', 'pending_cancel', 'cancelled', 'invalid'
  )),
  external_status_detail text,
  state public.order_state not null,
  currency char(3) not null,
  total_amount numeric(14, 2) not null,
  paid_amount numeric(14, 2) not null,
  is_test boolean not null,
  ordered_at timestamptz not null,
  closed_at timestamptz,
  external_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (marketplace_account_id, external_id)
);

create index orders_store_state_idx on public.orders (store_id, state);
create index orders_store_ordered_at_idx on public.orders (store_id, ordered_at desc);

create trigger orders_touch_updated_at
before update on public.orders
for each row execute function private.touch_updated_at();

create trigger orders_audit
after insert or update or delete on public.orders
for each row execute function audit.capture_change();

create table public.order_items (
  order_id uuid not null references public.orders (id) on delete cascade,
  line smallint not null check (line > 0),
  store_id uuid not null references public.stores (id) on delete restrict,
  external_item_id text not null,
  variation_id bigint,
  title text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(14, 2) not null,
  sale_fee numeric(14, 2),
  listing_type text,
  primary key (order_id, line)
);

create index order_items_store_id_idx on public.order_items (store_id);

alter table public.marketplace_accounts enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

revoke all on public.marketplace_accounts, public.orders, public.order_items from anon, authenticated;
grant select (id, store_id, channel, seller_id, status, access_token_expires_at, last_reconciled_at, created_at, updated_at)
  on public.marketplace_accounts to authenticated;
grant select on public.orders, public.order_items to authenticated;
grant all on public.marketplace_accounts, public.orders, public.order_items to service_role;

create policy marketplace_accounts_select on public.marketplace_accounts
for select to authenticated
using (private.has_store_role(store_id, array['owner', 'finance']::public.store_role[]));

create policy orders_select on public.orders
for select to authenticated
using (private.has_store_role(store_id, enum_range(null::public.store_role)));

create policy order_items_select on public.order_items
for select to authenticated
using (private.has_store_role(store_id, enum_range(null::public.store_role)));

create table ops.integration_events (
  id bigint generated always as identity primary key,
  topic text not null,
  resource text not null,
  external_user_id bigint not null,
  application_id bigint not null,
  attempts integer not null,
  sent_at timestamptz not null,
  received_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'processed', 'ignored', 'failed')),
  error text,
  processed_at timestamptz,
  correlation_id uuid not null
);

create unique index integration_events_pending_resource_idx
on ops.integration_events (topic, resource) where status = 'pending';

create index integration_events_received_at_idx on ops.integration_events (received_at desc);

alter table ops.integration_events enable row level security;

create function public.enqueue_marketplace_notification(
  p_topic text,
  p_resource text,
  p_external_user_id bigint,
  p_application_id bigint,
  p_attempts integer,
  p_sent_at timestamptz,
  p_correlation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id bigint;
begin
  insert into ops.integration_events (
    topic, resource, external_user_id, application_id, attempts, sent_at, correlation_id
  )
  values (
    p_topic, p_resource, p_external_user_id, p_application_id, p_attempts, p_sent_at, p_correlation_id
  )
  on conflict (topic, resource) where status = 'pending' do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return false;
  end if;

  perform pgmq.send('ml_notifications', jsonb_build_object('event_id', v_event_id));
  return true;
end;
$$;

create function public.claim_marketplace_notifications(p_batch integer, p_visibility_seconds integer)
returns table (
  msg_id bigint,
  read_count integer,
  event_id bigint,
  topic text,
  resource text,
  external_user_id bigint,
  marketplace_account_id uuid,
  correlation_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message record;
  v_event ops.integration_events;
begin
  for v_message in
    select m.msg_id, m.read_ct, (m.message ->> 'event_id')::bigint as event_id
    from pgmq.read('ml_notifications', p_visibility_seconds, p_batch) m
  loop
    update ops.integration_events e
    set status = 'processing'
    where e.id = v_message.event_id and e.status in ('pending', 'processing')
    returning e.* into v_event;

    if not found then
      perform pgmq.delete('ml_notifications', v_message.msg_id);
      continue;
    end if;

    msg_id := v_message.msg_id;
    read_count := v_message.read_ct;
    event_id := v_event.id;
    topic := v_event.topic;
    resource := v_event.resource;
    external_user_id := v_event.external_user_id;
    marketplace_account_id := (
      select a.id from public.marketplace_accounts a
      where a.channel = 'mercadolivre' and a.seller_id = v_event.external_user_id
        and a.status = 'active'
    );
    correlation_id := v_event.correlation_id;
    return next;
  end loop;
end;
$$;

create function public.complete_marketplace_notification(
  p_msg_id bigint,
  p_event_id bigint,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('processed', 'ignored', 'failed') then
    raise exception 'invalid completion status %', p_status using errcode = 'check_violation';
  end if;

  update ops.integration_events
  set status = p_status, error = left(p_error, 500), processed_at = now()
  where id = p_event_id;

  if p_status = 'failed' then
    perform pgmq.send('ml_notifications_dlq', jsonb_build_object('event_id', p_event_id));
  end if;

  perform pgmq.delete('ml_notifications', p_msg_id);
end;
$$;

create function public.kill_switch_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select enabled from ops.feature_flags where key = 'kill_switch.global'), true);
$$;

create function public.get_order_version(p_marketplace_account_id uuid, p_external_id bigint)
returns table (state public.order_state, external_updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.state, o.external_updated_at
  from public.orders o
  where o.marketplace_account_id = p_marketplace_account_id and o.external_id = p_external_id;
$$;

create function public.apply_order_snapshot(
  p_marketplace_account_id uuid,
  p_order jsonb,
  p_expected_state public.order_state,
  p_new_state public.order_state
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_order_id uuid;
  v_external_id bigint := (p_order ->> 'external_id')::bigint;
  v_updated_at timestamptz := (p_order ->> 'last_updated')::timestamptz;
  v_current public.orders;
begin
  select store_id into v_store_id
  from public.marketplace_accounts
  where id = p_marketplace_account_id;

  if v_store_id is null then
    raise exception 'unknown marketplace account' using errcode = 'foreign_key_violation';
  end if;

  select * into v_current
  from public.orders
  where marketplace_account_id = p_marketplace_account_id and external_id = v_external_id
  for update;

  if not found then
    if p_expected_state is not null then
      return 'conflict';
    end if;
    insert into public.orders (
      store_id, marketplace_account_id, external_id, pack_id, shipping_id, external_status,
      external_status_detail, state, currency, total_amount, paid_amount, is_test, ordered_at,
      closed_at, external_updated_at
    )
    values (
      v_store_id, p_marketplace_account_id, v_external_id,
      (p_order ->> 'pack_id')::bigint, (p_order ->> 'shipping_id')::bigint,
      p_order ->> 'status', p_order ->> 'status_detail', p_new_state, p_order ->> 'currency',
      (p_order ->> 'total_cents')::numeric / 100, (p_order ->> 'paid_cents')::numeric / 100,
      (p_order ->> 'is_test')::boolean, (p_order ->> 'created_at')::timestamptz,
      (p_order ->> 'closed_at')::timestamptz, v_updated_at
    )
    returning id into v_order_id;
  else
    if v_current.external_updated_at >= v_updated_at then
      return 'stale';
    end if;
    if p_expected_state is distinct from v_current.state then
      return 'conflict';
    end if;
    update public.orders
    set pack_id = (p_order ->> 'pack_id')::bigint,
        shipping_id = (p_order ->> 'shipping_id')::bigint,
        external_status = p_order ->> 'status',
        external_status_detail = p_order ->> 'status_detail',
        state = p_new_state,
        currency = p_order ->> 'currency',
        total_amount = (p_order ->> 'total_cents')::numeric / 100,
        paid_amount = (p_order ->> 'paid_cents')::numeric / 100,
        is_test = (p_order ->> 'is_test')::boolean,
        closed_at = (p_order ->> 'closed_at')::timestamptz,
        external_updated_at = v_updated_at
    where id = v_current.id;
    v_order_id := v_current.id;
    delete from public.order_items where order_id = v_order_id;
  end if;

  insert into public.order_items (
    order_id, line, store_id, external_item_id, variation_id, title, quantity, unit_price,
    sale_fee, listing_type
  )
  select v_order_id, i.ordinality::smallint, v_store_id, i.item ->> 'item_id',
    (i.item ->> 'variation_id')::bigint, i.item ->> 'title', (i.item ->> 'quantity')::integer,
    (i.item ->> 'unit_price_cents')::numeric / 100, (i.item ->> 'sale_fee_cents')::numeric / 100,
    i.item ->> 'listing_type_id'
  from jsonb_array_elements(p_order -> 'items') with ordinality as i(item, ordinality);

  return case when v_current.id is null then 'inserted' else 'updated' end;
end;
$$;

create function public.store_marketplace_tokens(
  p_marketplace_account_id uuid,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tokens private.marketplace_tokens;
begin
  select * into v_tokens
  from private.marketplace_tokens
  where marketplace_account_id = p_marketplace_account_id
  for update;

  if not found then
    insert into private.marketplace_tokens (
      marketplace_account_id, access_token_secret_id, refresh_token_secret_id
    )
    values (
      p_marketplace_account_id,
      vault.create_secret(p_access_token, 'ml_access_' || p_marketplace_account_id),
      vault.create_secret(p_refresh_token, 'ml_refresh_' || p_marketplace_account_id)
    );
  else
    perform vault.update_secret(v_tokens.access_token_secret_id, p_access_token);
    perform vault.update_secret(v_tokens.refresh_token_secret_id, p_refresh_token);
    update private.marketplace_tokens set updated_at = now()
    where marketplace_account_id = p_marketplace_account_id;
  end if;

  update public.marketplace_accounts
  set access_token_expires_at = p_expires_at, status = 'active', refresh_lease_until = null
  where id = p_marketplace_account_id;
end;
$$;

create function public.read_marketplace_tokens(p_marketplace_account_id uuid)
returns table (access_token text, refresh_token text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select access_secret.decrypted_secret, refresh_secret.decrypted_secret, a.access_token_expires_at
  from private.marketplace_tokens t
  join public.marketplace_accounts a on a.id = t.marketplace_account_id
  join vault.decrypted_secrets access_secret on access_secret.id = t.access_token_secret_id
  join vault.decrypted_secrets refresh_secret on refresh_secret.id = t.refresh_token_secret_id
  where t.marketplace_account_id = p_marketplace_account_id;
$$;

create function public.acquire_token_refresh_lease(p_marketplace_account_id uuid, p_seconds integer)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with acquired as (
    update public.marketplace_accounts
    set refresh_lease_until = now() + make_interval(secs => p_seconds)
    where id = p_marketplace_account_id
      and (refresh_lease_until is null or refresh_lease_until < now())
    returning id
  )
  select exists (select 1 from acquired);
$$;

create function public.mark_reauthorization_required(p_marketplace_account_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.marketplace_accounts
  set status = 'reauthorization_required', refresh_lease_until = null
  where id = p_marketplace_account_id;
$$;

revoke execute on function
  public.enqueue_marketplace_notification(text, text, bigint, bigint, integer, timestamptz, uuid),
  public.claim_marketplace_notifications(integer, integer),
  public.complete_marketplace_notification(bigint, bigint, text, text),
  public.get_order_version(uuid, bigint),
  public.apply_order_snapshot(uuid, jsonb, public.order_state, public.order_state),
  public.store_marketplace_tokens(uuid, text, text, timestamptz),
  public.read_marketplace_tokens(uuid),
  public.acquire_token_refresh_lease(uuid, integer),
  public.mark_reauthorization_required(uuid),
  public.kill_switch_active()
from public, anon, authenticated;

grant select on ops.integration_events to service_role;
grant execute on function
  public.enqueue_marketplace_notification(text, text, bigint, bigint, integer, timestamptz, uuid),
  public.claim_marketplace_notifications(integer, integer),
  public.complete_marketplace_notification(bigint, bigint, text, text),
  public.get_order_version(uuid, bigint),
  public.apply_order_snapshot(uuid, jsonb, public.order_state, public.order_state),
  public.store_marketplace_tokens(uuid, text, text, timestamptz),
  public.read_marketplace_tokens(uuid),
  public.acquire_token_refresh_lease(uuid, integer),
  public.mark_reauthorization_required(uuid),
  public.kill_switch_active()
to service_role;
