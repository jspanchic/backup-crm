-- Apply only to the dedicated production database, after migrations and before importing approved prices.
begin;

do $$
declare
  brand_id_to_configure bigint;
begin
  select id into strict brand_id_to_configure from core.brands where slug = 'salvionix' for update;

  if exists (select 1 from core.channels where is_test or identifier = 'bytogam-pruebas')
    or exists (select 1 from core.price_lists where not is_confirmed)
    or exists (select 1 from core.scheduling_settings where not is_confirmed)
    or exists (select 1 from public.contacts where is_test)
    or exists (select 1 from public.deals where is_test)
    or exists (select 1 from public.sales where email = 'sebastian@example.test')
    or exists (select 1 from core.technicians where name in ('Sample Technician', 'Aplicador de ejemplo (Orlando)')) then
    raise exception 'Test configuration or data found. Use the separate production database.';
  end if;

  update core.brands
     set tax_pct = 0, discount_enabled = true, bot_agenda_enabled = false
   where id = brand_id_to_configure;

  if not exists (select 1 from core.channels where provider = 'waha' and identifier = 'salvionix') then
    update core.brands set bot_enabled = false where id = brand_id_to_configure;
    insert into core.channels (brand_id, provider, identifier, bot_key, secret_ref, is_test)
      values (brand_id_to_configure, 'waha', 'salvionix', 'javier', 'WAHA_HMAC_SALVIONIX', false);
  elsif not exists (
    select 1 from core.channels
    where provider = 'waha' and identifier = 'salvionix' and brand_id = brand_id_to_configure
      and bot_key = 'javier' and secret_ref = 'WAHA_HMAC_SALVIONIX' and not is_test
  ) then
    raise exception 'The existing Salvionix channel does not match the production configuration.';
  end if;
end;
$$;

commit;
