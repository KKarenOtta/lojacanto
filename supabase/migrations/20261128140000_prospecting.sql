alter table public.suppliers
  add column contact_email text
    check (contact_email = lower(contact_email) and length(contact_email) <= 254),
  add column contact_source_url text
    check (contact_source_url ~ '^https://' and length(contact_source_url) <= 500),
  add column categories text[] not null default '{}'
    check (cardinality(categories) <= 5),
  add column prospect_stage text not null default 'candidate'
    check (prospect_stage in ('candidate', 'contacted', 'replied', 'qualified', 'rejected', 'opted_out')),
  add constraint suppliers_contact_source_required
    check (contact_email is null or contact_source_url is not null);

create table public.message_template_approvals (
  store_id uuid not null references public.stores (id) on delete restrict,
  template text not null check (template ~ '^[a-z_]+@[0-9]+$'),
  approved_by uuid not null references auth.users (id),
  approved_at timestamptz not null default now(),
  primary key (store_id, template)
);

create trigger message_template_approvals_audit
after insert or update or delete on public.message_template_approvals
for each row execute function audit.capture_change();

alter table public.message_template_approvals enable row level security;

revoke all on public.message_template_approvals from anon, authenticated;
grant select on public.message_template_approvals to authenticated;

create policy message_template_approvals_select on public.message_template_approvals
for select to authenticated
using (private.has_store_role(store_id, array['owner', 'operator']::public.store_role[]));

create function public.approve_message_template(p_store_id uuid, p_template text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_store_role(p_store_id, array['owner']::public.store_role[]) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  insert into public.message_template_approvals (store_id, template, approved_by)
  values (p_store_id, p_template, auth.uid())
  on conflict (store_id, template) do nothing;
end;
$$;

create function public.prospecting_context(p_store_id uuid)
returns table (
  sender_id uuid,
  sender_address text,
  approved_templates text[],
  prospecting_today integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,
    s.address,
    coalesce(
      (select array_agg(a.template order by a.template)
       from public.message_template_approvals a where a.store_id = p_store_id),
      '{}'
    ),
    (select count(*)::integer
     from public.outbound_messages m
     where m.store_id = p_store_id
       and m.kind in ('supplier_prospecting', 'supplier_follow_up')
       and m.status in ('approved', 'sending', 'sent')
       and (m.created_at at time zone 'America/Sao_Paulo')::date
         = (now() at time zone 'America/Sao_Paulo')::date)
  from public.email_senders s
  where s.store_id = p_store_id and s.provider = 'gmail' and s.status = 'active'
  order by s.authorized_at desc
  limit 1;
$$;

create function public.prospecting_candidates(p_store_id uuid, p_limit integer)
returns table (
  supplier_id uuid,
  name text,
  contact_email text,
  categories text[],
  prospect_stage text,
  suppressed boolean,
  previous_contacts integer,
  last_contact_at timestamptz,
  pending boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    sp.id,
    sp.name,
    sp.contact_email,
    sp.categories,
    sp.prospect_stage,
    exists (
      select 1 from public.email_suppressions e
      where e.store_id = sp.store_id and e.address = sp.contact_email
    ),
    (select count(*)::integer from public.outbound_messages m
     where m.supplier_id = sp.id and m.status = 'sent'
       and m.kind in ('supplier_prospecting', 'supplier_follow_up')),
    (select max(m.sent_at) from public.outbound_messages m where m.supplier_id = sp.id),
    exists (
      select 1 from public.outbound_messages m
      where m.supplier_id = sp.id and m.status in ('awaiting_approval', 'approved', 'sending')
    )
  from public.suppliers sp
  where sp.store_id = p_store_id
    and sp.status = 'active'
    and sp.contact_email is not null
    and sp.prospect_stage in ('candidate', 'contacted')
    and cardinality(sp.categories) > 0
  order by sp.prospect_stage, sp.created_at
  limit least(greatest(p_limit, 1), 100);
$$;

create function public.set_prospect_stage(p_supplier_id uuid, p_stage text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.suppliers set prospect_stage = p_stage where id = p_supplier_id;
  if not found then
    raise exception 'supplier % not found', p_supplier_id using errcode = 'no_data_found';
  end if;
end;
$$;

revoke execute on function public.approve_message_template(uuid, text) from public, anon;
grant execute on function public.approve_message_template(uuid, text) to authenticated;

revoke execute on function
  public.prospecting_context(uuid),
  public.prospecting_candidates(uuid, integer),
  public.set_prospect_stage(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.prospecting_context(uuid),
  public.prospecting_candidates(uuid, integer),
  public.set_prospect_stage(uuid, text)
to service_role;
