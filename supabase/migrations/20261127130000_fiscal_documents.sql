alter table public.marketplace_accounts
  add column fiscal_profile text not null default 'individual'
    check (fiscal_profile in ('individual', 'company_non_taxpayer', 'company_taxpayer'));

create table public.fiscal_documents (
  order_id uuid primary key references public.orders (id) on delete restrict,
  store_id uuid not null references public.stores (id) on delete restrict,
  kind text not null check (kind in ('dce', 'nfe')),
  status text not null check (status in ('emission_failed', 'requested', 'pending', 'completed', 'error')),
  coverage_id text check (length(coverage_id) <= 64),
  document_key text check (length(document_key) <= 64),
  error_code text check (length(error_code) <= 40),
  alert_level text not null default 'ok' check (alert_level in ('ok', 'warning', 'critical', 'overdue')),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index fiscal_documents_open_idx on public.fiscal_documents (store_id, status)
where status <> 'completed';

create trigger fiscal_documents_touch_updated_at
before update on public.fiscal_documents
for each row execute function private.touch_updated_at();

create trigger fiscal_documents_audit
after insert or update or delete on public.fiscal_documents
for each row execute function audit.capture_change();

alter table public.fiscal_documents enable row level security;

revoke all on public.fiscal_documents from anon, authenticated;
grant select on public.fiscal_documents to authenticated;
grant select, insert, update on public.fiscal_documents to service_role;

create policy fiscal_documents_select on public.fiscal_documents
for select to authenticated
using (private.has_store_role(store_id, array['owner', 'finance', 'operator']::public.store_role[]));

create function public.dce_candidates(p_limit integer)
returns table (
  order_id uuid,
  marketplace_account_id uuid,
  external_id bigint,
  ordered_at timestamptz,
  status text,
  alert_level text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.marketplace_account_id, o.external_id, o.ordered_at, d.status, coalesce(d.alert_level, 'ok')
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

create function public.record_fiscal_document(
  p_order_id uuid,
  p_status text,
  p_coverage_id text default null,
  p_document_key text default null,
  p_error_code text default null,
  p_alert_level text default null
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

  insert into public.fiscal_documents (
    order_id, store_id, kind, status, coverage_id, document_key, error_code, alert_level
  )
  values (
    p_order_id, v_store_id, 'dce', p_status, p_coverage_id, p_document_key, p_error_code,
    coalesce(p_alert_level, 'ok')
  )
  on conflict (order_id) do update
  set status = excluded.status,
      coverage_id = coalesce(excluded.coverage_id, public.fiscal_documents.coverage_id),
      document_key = coalesce(excluded.document_key, public.fiscal_documents.document_key),
      error_code = excluded.error_code,
      alert_level = coalesce(p_alert_level, public.fiscal_documents.alert_level)
  where public.fiscal_documents.status <> 'completed';
end;
$$;

revoke execute on function public.dce_candidates(integer) from public, anon, authenticated;
revoke execute on function public.record_fiscal_document(uuid, text, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.dce_candidates(integer) to service_role;
grant execute on function public.record_fiscal_document(uuid, text, text, text, text, text)
to service_role;
