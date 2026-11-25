create table public.email_senders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  provider text not null check (provider = 'gmail'),
  address text not null check (address = lower(address) and address ~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$'),
  status text not null check (status in ('active', 'reauthorization_required')),
  authorized_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, provider, address)
);

create trigger email_senders_touch_updated_at
before update on public.email_senders
for each row execute function private.touch_updated_at();

create trigger email_senders_audit
after insert or update or delete on public.email_senders
for each row execute function audit.capture_change();

create table private.email_credentials (
  sender_id uuid primary key references public.email_senders (id) on delete cascade,
  refresh_token_secret_id uuid not null,
  updated_at timestamptz not null default now()
);

alter table private.email_credentials enable row level security;
alter table public.email_senders enable row level security;

revoke all on public.email_senders from anon, authenticated;
grant select on public.email_senders to authenticated;

create policy email_senders_select on public.email_senders
for select to authenticated
using (private.has_store_role(store_id, array['owner']::public.store_role[]));

create function public.store_email_credentials(
  p_store_id uuid,
  p_address text,
  p_refresh_token text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_id uuid;
  v_secret_id uuid;
begin
  if coalesce(length(p_refresh_token), 0) = 0 then
    raise exception 'refresh token required' using errcode = '22023';
  end if;

  insert into public.email_senders (store_id, provider, address, status, authorized_at)
  values (p_store_id, 'gmail', lower(p_address), 'active', now())
  on conflict (store_id, provider, address)
  do update set status = 'active', authorized_at = now()
  returning id into v_sender_id;

  select refresh_token_secret_id into v_secret_id
  from private.email_credentials
  where sender_id = v_sender_id
  for update;

  if v_secret_id is null then
    insert into private.email_credentials (sender_id, refresh_token_secret_id)
    values (v_sender_id, vault.create_secret(p_refresh_token, 'gmail_refresh_' || v_sender_id));
  else
    perform vault.update_secret(v_secret_id, p_refresh_token);
    update private.email_credentials set updated_at = now() where sender_id = v_sender_id;
  end if;

  return v_sender_id;
end;
$$;

create function public.read_email_credentials(p_store_id uuid, p_address text)
returns table (sender_id uuid, refresh_token text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, secret.decrypted_secret
  from public.email_senders s
  join private.email_credentials c on c.sender_id = s.id
  join vault.decrypted_secrets secret on secret.id = c.refresh_token_secret_id
  where s.store_id = p_store_id
    and s.address = lower(p_address)
    and s.status = 'active';
$$;

create function public.mark_email_reauthorization_required(p_sender_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.email_senders
  set status = 'reauthorization_required'
  where id = p_sender_id and status <> 'reauthorization_required';
$$;

revoke execute on function
  public.store_email_credentials(uuid, text, text),
  public.read_email_credentials(uuid, text),
  public.mark_email_reauthorization_required(uuid)
from public, anon, authenticated;

grant execute on function
  public.store_email_credentials(uuid, text, text),
  public.read_email_credentials(uuid, text),
  public.mark_email_reauthorization_required(uuid)
to service_role;
