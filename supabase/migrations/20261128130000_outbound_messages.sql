create table public.email_suppressions (
  store_id uuid not null references public.stores (id) on delete restrict,
  address text not null check (address = lower(address) and length(address) <= 254),
  reason text not null check (reason in ('opt_out', 'bounce', 'manual')),
  created_at timestamptz not null default now(),
  primary key (store_id, address)
);

create trigger email_suppressions_audit
after insert or update or delete on public.email_suppressions
for each row execute function audit.capture_change();

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  sender_id uuid not null references public.email_senders (id) on delete restrict,
  supplier_id uuid references public.suppliers (id) on delete restrict,
  purchase_order_id uuid references public.purchase_orders (id) on delete restrict,
  kind text not null check (kind in ('supplier_prospecting', 'supplier_follow_up', 'purchase_order')),
  recipient text not null check (recipient = lower(recipient) and length(recipient) <= 254),
  template text not null check (template ~ '^[a-z_]+@[0-9]+$'),
  subject text not null check (length(subject) between 1 and 200 and subject !~ '[\r\n]'),
  body text not null check (length(body) between 1 and 20000),
  in_reply_to text check (in_reply_to ~ '^<[^<>\s]+>$'),
  status text not null check (status in (
    'awaiting_approval', 'approved', 'sending', 'sent', 'failed', 'blocked', 'cancelled'
  )),
  decision_reason text check (length(decision_reason) <= 40),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  attempts smallint not null default 0 check (attempts between 0 and 10),
  last_error text check (length(last_error) <= 80),
  provider_message_id text check (length(provider_message_id) <= 64),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'purchase_order') = (purchase_order_id is not null)),
  check ((status = 'sent') = (sent_at is not null and provider_message_id is not null))
);

create index outbound_messages_ready_idx on public.outbound_messages (created_at)
where status = 'approved';
create index outbound_messages_recipient_idx on public.outbound_messages (store_id, recipient, sent_at);

create trigger outbound_messages_touch_updated_at
before update on public.outbound_messages
for each row execute function private.touch_updated_at();

create trigger outbound_messages_audit
after insert or update or delete on public.outbound_messages
for each row execute function audit.capture_change();

alter table public.email_suppressions enable row level security;
alter table public.outbound_messages enable row level security;

revoke all on public.email_suppressions, public.outbound_messages from anon, authenticated;
grant select on public.email_suppressions, public.outbound_messages to authenticated;

create policy email_suppressions_select on public.email_suppressions
for select to authenticated
using (private.has_store_role(store_id, array['owner', 'operator']::public.store_role[]));

create policy outbound_messages_select on public.outbound_messages
for select to authenticated
using (private.has_store_role(store_id, array['owner', 'operator']::public.store_role[]));

create function public.recipient_contact_stats(p_store_id uuid, p_recipient text)
returns table (previous_contacts integer, last_contact_at timestamptz, prospecting_today integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*) filter (where m.recipient = lower(p_recipient) and m.kind <> 'purchase_order')::integer,
    max(m.sent_at) filter (where m.recipient = lower(p_recipient)),
    count(*) filter (
      where m.kind in ('supplier_prospecting', 'supplier_follow_up')
        and (m.sent_at at time zone 'America/Sao_Paulo')::date
          = (now() at time zone 'America/Sao_Paulo')::date
    )::integer
  from public.outbound_messages m
  where m.store_id = p_store_id and m.status = 'sent';
$$;

create function public.enqueue_outbound_message(
  p_store_id uuid,
  p_sender_id uuid,
  p_kind text,
  p_recipient text,
  p_template text,
  p_subject text,
  p_body text,
  p_status text,
  p_decision_reason text default null,
  p_supplier_id uuid default null,
  p_purchase_order_id uuid default null,
  p_in_reply_to text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text := p_status;
  v_reason text := p_decision_reason;
begin
  if p_status not in ('awaiting_approval', 'approved', 'blocked') then
    raise exception 'invalid initial status %', p_status using errcode = '22023';
  end if;
  if exists (
    select 1 from public.email_suppressions
    where store_id = p_store_id and address = lower(p_recipient)
  ) then
    v_status := 'blocked';
    v_reason := 'suppressed';
  end if;

  insert into public.outbound_messages (
    store_id, sender_id, supplier_id, purchase_order_id, kind, recipient, template,
    subject, body, in_reply_to, status, decision_reason
  )
  values (
    p_store_id, p_sender_id, p_supplier_id, p_purchase_order_id, p_kind, lower(p_recipient),
    p_template, p_subject, p_body, p_in_reply_to, v_status, v_reason
  )
  returning id into v_id;
  return v_id;
end;
$$;

create function public.approve_outbound_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.outbound_messages;
begin
  select * into v_message from public.outbound_messages where id = p_message_id for update;
  if not found or not private.has_store_role(v_message.store_id, array['owner']::public.store_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_message.status <> 'awaiting_approval' then
    raise exception 'message is %', v_message.status using errcode = 'check_violation';
  end if;
  update public.outbound_messages
  set status = 'approved', approved_by = auth.uid(), approved_at = now()
  where id = p_message_id;
end;
$$;

create function public.claim_outbound_messages(p_limit integer)
returns table (
  id uuid,
  store_id uuid,
  sender_id uuid,
  sender_address text,
  recipient text,
  subject text,
  body text,
  in_reply_to text,
  attempts smallint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.kill_switch_active() then
    return;
  end if;

  update public.outbound_messages m
  set status = 'blocked', decision_reason = 'suppressed'
  where m.status = 'approved'
    and exists (
      select 1 from public.email_suppressions s
      where s.store_id = m.store_id and s.address = m.recipient
    );

  return query
  with picked as (
    select m.id
    from public.outbound_messages m
    join public.email_senders s on s.id = m.sender_id and s.status = 'active'
    where m.status = 'approved'
    order by m.created_at
    limit least(greatest(p_limit, 1), 50)
    for update of m skip locked
  )
  update public.outbound_messages m
  set status = 'sending', attempts = m.attempts + 1
  from picked, public.email_senders s
  where m.id = picked.id and s.id = m.sender_id
  returning m.id, m.store_id, m.sender_id, s.address, m.recipient, m.subject, m.body,
    m.in_reply_to, m.attempts;
end;
$$;

create function public.complete_outbound_message(
  p_message_id uuid,
  p_outcome text,
  p_provider_message_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outcome not in ('sent', 'retry', 'failed') then
    raise exception 'invalid outcome %', p_outcome using errcode = '22023';
  end if;
  update public.outbound_messages
  set status = case p_outcome
        when 'sent' then 'sent'
        when 'retry' then case when attempts >= 5 then 'failed' else 'approved' end
        else 'failed'
      end,
      provider_message_id = case when p_outcome = 'sent' then p_provider_message_id end,
      sent_at = case when p_outcome = 'sent' then now() end,
      last_error = left(p_error, 80)
  where id = p_message_id and status = 'sending';
  if not found then
    raise exception 'message % is not sending', p_message_id using errcode = 'check_violation';
  end if;
end;
$$;

create function public.suppress_email_address(p_store_id uuid, p_address text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.email_suppressions (store_id, address, reason)
  values (p_store_id, lower(p_address), p_reason)
  on conflict (store_id, address) do nothing;

  update public.outbound_messages
  set status = 'blocked', decision_reason = 'suppressed'
  where store_id = p_store_id
    and recipient = lower(p_address)
    and status in ('awaiting_approval', 'approved');
end;
$$;

revoke execute on function public.approve_outbound_message(uuid) from public, anon;
grant execute on function public.approve_outbound_message(uuid) to authenticated;

revoke execute on function
  public.recipient_contact_stats(uuid, text),
  public.enqueue_outbound_message(uuid, uuid, text, text, text, text, text, text, text, uuid, uuid, text),
  public.claim_outbound_messages(integer),
  public.complete_outbound_message(uuid, text, text, text),
  public.suppress_email_address(uuid, text, text)
from public, anon, authenticated;

grant execute on function
  public.recipient_contact_stats(uuid, text),
  public.enqueue_outbound_message(uuid, uuid, text, text, text, text, text, text, text, uuid, uuid, text),
  public.claim_outbound_messages(integer),
  public.complete_outbound_message(uuid, text, text, text),
  public.suppress_email_address(uuid, text, text)
to service_role;
