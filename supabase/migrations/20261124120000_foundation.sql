create schema private;
create schema audit;
create schema ops;

revoke all on schema private, audit, ops from public, anon, authenticated;

create type public.store_role as enum ('owner', 'operator', 'finance', 'viewer');

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.store_members (
  store_id uuid not null references public.stores (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.store_role not null,
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create index store_members_user_id_idx on public.store_members (user_id);

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger stores_touch_updated_at
before update on public.stores
for each row execute function private.touch_updated_at();

create function private.has_store_role(p_store_id uuid, p_roles public.store_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false)
    and exists (
      select 1
      from public.store_members m
      where m.store_id = p_store_id
        and m.user_id = (select auth.uid())
        and m.role = any (p_roles)
    );
$$;

grant usage on schema private to authenticated;

alter table public.stores enable row level security;
alter table public.store_members enable row level security;

revoke all on public.stores, public.store_members from anon, authenticated;
grant select on public.stores to authenticated;
grant update (name) on public.stores to authenticated;
grant select, insert, delete on public.store_members to authenticated;
grant update (role) on public.store_members to authenticated;

create policy stores_select on public.stores
for select to authenticated
using (private.has_store_role(id, enum_range(null::public.store_role)));

create policy stores_update on public.stores
for update to authenticated
using (private.has_store_role(id, array['owner']::public.store_role[]))
with check (private.has_store_role(id, array['owner']::public.store_role[]));

create policy store_members_select on public.store_members
for select to authenticated
using (private.has_store_role(store_id, enum_range(null::public.store_role)));

create policy store_members_insert on public.store_members
for insert to authenticated
with check (private.has_store_role(store_id, array['owner']::public.store_role[]));

create policy store_members_update on public.store_members
for update to authenticated
using (private.has_store_role(store_id, array['owner']::public.store_role[]))
with check (private.has_store_role(store_id, array['owner']::public.store_role[]));

create policy store_members_delete on public.store_members
for delete to authenticated
using (private.has_store_role(store_id, array['owner']::public.store_role[]));

create table audit.chain_head (
  singleton boolean primary key default true check (singleton),
  seq bigint not null,
  hash bytea
);

insert into audit.chain_head (seq, hash) values (0, null);

create table audit.events (
  seq bigint primary key,
  store_id uuid references public.stores (id) on delete restrict,
  actor_type text not null check (actor_type in ('user', 'service', 'system')),
  actor_id text not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  correlation_id uuid not null,
  occurred_at timestamptz not null default now(),
  prev_hash bytea,
  hash bytea not null
);

create index audit_events_store_id_idx on audit.events (store_id, occurred_at desc);
create index audit_events_correlation_id_idx on audit.events (correlation_id);

alter table audit.events enable row level security;
alter table audit.chain_head enable row level security;

create function audit.compute_hash(e audit.events)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select sha256(
    coalesce(e.prev_hash, ''::bytea)
    || convert_to(
      concat_ws(
        '|',
        e.seq,
        coalesce(e.store_id::text, ''),
        e.actor_type,
        e.actor_id,
        e.action,
        e.entity_type,
        coalesce(e.entity_id, ''),
        coalesce(e.before::text, ''),
        coalesce(e.after::text, ''),
        e.correlation_id,
        to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ),
      'UTF8'
    )
  );
$$;

create function audit.chain_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  head audit.chain_head;
begin
  select * into head from audit.chain_head for update;
  new.seq := head.seq + 1;
  new.prev_hash := head.hash;
  new.occurred_at := now();
  new.hash := audit.compute_hash(new);
  update audit.chain_head set seq = new.seq, hash = new.hash;
  return new;
end;
$$;

create trigger events_chain
before insert on audit.events
for each row execute function audit.chain_event();

create function audit.reject_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit.events is append-only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger events_no_update_delete
before update or delete on audit.events
for each row execute function audit.reject_change();

create trigger events_no_truncate
before truncate on audit.events
for each statement execute function audit.reject_change();

create function audit.verify_chain()
returns bigint
language sql
stable
set search_path = ''
as $$
  with ordered as (
    select e, lag(e.hash) over (order by e.seq) as expected_prev
    from audit.events e
  )
  select min((o.e).seq)
  from ordered o
  where (o.e).prev_hash is distinct from o.expected_prev
     or (o.e).hash <> audit.compute_hash(o.e);
$$;

create function audit.capture_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  actor_uid text := claims ->> 'sub';
  row_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  row_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  row_ref jsonb := coalesce(row_new, row_old);
begin
  insert into audit.events (
    store_id, actor_type, actor_id, action, entity_type, entity_id,
    before, after, correlation_id
  )
  values (
    coalesce((row_ref ->> 'store_id')::uuid, case when tg_table_name = 'stores' then (row_ref ->> 'id')::uuid end),
    case when actor_uid is not null then 'user' else 'service' end,
    coalesce(actor_uid, coalesce(claims ->> 'role', session_user)),
    lower(tg_op),
    tg_table_schema || '.' || tg_table_name,
    coalesce(row_ref ->> 'id', row_ref ->> 'user_id', row_ref ->> 'key'),
    row_old,
    row_new,
    coalesce(nullif(current_setting('app.correlation_id', true), '')::uuid, gen_random_uuid())
  );
  return null;
end;
$$;

create trigger stores_audit
after insert or update or delete on public.stores
for each row execute function audit.capture_change();

create trigger store_members_audit
after insert or update or delete on public.store_members
for each row execute function audit.capture_change();

create table ops.feature_flags (
  key text primary key check (key ~ '^[a-z0-9_.]+$'),
  enabled boolean not null,
  updated_at timestamptz not null default now()
);

create trigger feature_flags_touch_updated_at
before update on ops.feature_flags
for each row execute function private.touch_updated_at();

create trigger feature_flags_audit
after insert or update or delete on ops.feature_flags
for each row execute function audit.capture_change();

insert into ops.feature_flags (key, enabled) values ('kill_switch.global', false);

create table ops.health_checks (
  id bigint generated always as identity primary key,
  check_name text not null,
  status text not null check (status in ('ok', 'warn', 'critical')),
  detail jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);

create index health_checks_name_observed_idx on ops.health_checks (check_name, observed_at desc);

alter table ops.feature_flags enable row level security;
alter table ops.health_checks enable row level security;

revoke execute on all functions in schema private, audit from public;
grant execute on function private.has_store_role(uuid, public.store_role[]) to authenticated;

grant all on public.stores, public.store_members to service_role;
grant usage on schema audit, ops to service_role;
grant select, insert on audit.events to service_role;
grant select on audit.chain_head to service_role;
grant select, insert, update on ops.feature_flags to service_role;
grant select, insert on ops.health_checks to service_role;
grant execute on function audit.verify_chain() to service_role;
