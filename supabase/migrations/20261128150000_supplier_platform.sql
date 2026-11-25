alter table public.suppliers
  drop constraint suppliers_order_channel_check,
  add constraint suppliers_order_channel_check
    check (order_channel in ('manual', 'email', 'api', 'platform')),
  add column platform_name text check (length(platform_name) between 1 and 60),
  add column cutoff_hour smallint check (cutoff_hour between 0 and 23),
  add constraint suppliers_platform_name_required
    check ((order_channel = 'platform') = (platform_name is not null));
