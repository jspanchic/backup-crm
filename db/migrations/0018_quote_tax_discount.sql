-- Quote presentation (Orlando's corrections): a tax rate per brand, and a switch for the discount, both frozen on
-- every quote when it is created. The total is still calculated here and nowhere else: it now includes the tax.
-- Defaults keep today's behaviour: tax 0 and discount on. Existing quotes keep their amounts (tax 0, discount as it was).
-- Change them with, for example:
--   update core.brands set tax_pct = 6.5, discount_enabled = false where id = 1;
-- Forward only: nothing applied earlier is edited; three functions are replaced with `create or replace`.

alter table core.brands
  add column tax_pct numeric(5, 2) not null default 0 check (tax_pct between 0 and 100),
  add column discount_enabled boolean not null default true;

alter table core.quotes
  add column tax_pct numeric(5, 2) not null default 0 check (tax_pct between 0 and 100),
  add column tax numeric(12, 2) not null default 0 check (tax >= 0),
  add column discount_applied boolean not null default true;

-- 1. The totals of a new quote: the brand's discount switch and tax rate.
create or replace function core.quotes_before_insert() returns trigger
  language plpgsql
  set search_path = ''
  as $$
declare
  deal_brand_id bigint;
  pl core.price_lists;
  totals record;
  v_brand core.brands;
  v_raw numeric;
  v_before_tax numeric;
begin
  select brand_id into deal_brand_id from public.deals where id = new.deal_id for update;
  if not found then
    raise exception 'unknown deal %', new.deal_id using errcode = 'CX004';
  end if;
  new.brand_id := deal_brand_id;

  new.price_list_id := coalesce(new.price_list_id, core.active_price_list(new.brand_id));
  select * into pl from core.price_lists where id = new.price_list_id and brand_id = new.brand_id;
  if not found then
    raise exception 'no price list for this brand' using errcode = 'CX004';
  end if;

  select * into v_brand from core.brands where id = new.brand_id;
  select * into totals from core.quote_totals(pl.id, new.covered_sqft, new.uncovered_sqft);
  if v_brand.discount_enabled then
    new.subtotal := totals.subtotal;
    new.discount := totals.discount;
    v_before_tax := totals.total;
    new.min_applied := totals.min_applied;
  else
    -- The brand switched its discount off: same rule of the sales prompt without the discount.
    v_raw := new.covered_sqft * pl.covered_rate + new.uncovered_sqft * pl.uncovered_rate;
    new.subtotal := round(v_raw, 2);
    new.discount := 0;
    v_before_tax := round(v_raw, 0);
    new.min_applied := v_before_tax < pl.min_total;
    if new.min_applied then
      v_before_tax := pl.min_total;
    end if;
  end if;
  new.discount_applied := v_brand.discount_enabled;
  -- The tax is the brand's rate on the amount after discount and minimum, frozen with the quote.
  new.tax_pct := v_brand.tax_pct;
  new.tax := round(v_before_tax * v_brand.tax_pct / 100, 2);
  new.total := v_before_tax + new.tax;
  new.currency := pl.currency;
  new.price_confirmed := pl.is_confirmed;

  -- The row lock on the deal above serializes this count.
  select coalesce(max(version), 0) + 1 into new.version from core.quotes where deal_id = new.deal_id;
  return new;
end;
$$;

-- 2. The numbered document freezes the tax and the discount switch together with the amounts of its quote.

create or replace function core.documents_before_insert() returns trigger
  language plpgsql
  set search_path = ''
  as $$
declare
  deal public.deals;
  quote core.quotes;
  appointment core.appointments;
  counter core.document_counters;
begin
  select * into deal from public.deals where id = new.deal_id;
  if not found then
    raise exception 'unknown deal %', new.deal_id using errcode = 'CX004';
  end if;

  select * into quote from core.quotes where id = new.quote_id;
  if not found or quote.deal_id <> new.deal_id then
    raise exception 'the quote does not belong to this deal' using errcode = 'CX004';
  end if;

  if new.document_type <> 'quote' then
    select * into appointment from core.appointments where id = new.appointment_id;
    if not found or appointment.deal_id <> new.deal_id then
      raise exception 'the appointment does not belong to this deal' using errcode = 'CX004';
    end if;
    -- The purchase order goes out for the customer to confirm, so a live hold is enough.
    -- A work order sends a technician, so it needs a confirmed appointment.
    if new.document_type = 'purchase_order' and appointment.status not in ('hold', 'confirmed') then
      raise exception 'a purchase order needs a held or confirmed appointment' using errcode = 'CX002';
    end if;
    if new.document_type = 'work_order' and appointment.status <> 'confirmed' then
      raise exception 'a work order needs a confirmed appointment' using errcode = 'CX002';
    end if;
  end if;

  new.brand_id := deal.brand_id;
  new.is_test := deal.is_test;
  -- Amounts come from the quote, which the database calculated. Whatever the caller wrote is replaced,
  -- so a document can never show a different figure from its quote.
  new.payload := coalesce(new.payload, '{}'::jsonb) || jsonb_build_object(
    'quote_version', quote.version,
    'covered_sqft', quote.covered_sqft,
    'uncovered_sqft', quote.uncovered_sqft,
    'subtotal', quote.subtotal,
    'discount', quote.discount,
    'total', quote.total,
    'min_applied', quote.min_applied,
    'currency', quote.currency,
    'price_confirmed', quote.price_confirmed,
    'discount_applied', quote.discount_applied,
    'tax_pct', quote.tax_pct,
    'tax', quote.tax
  );

  update core.document_counters
  set last_number = last_number + 1
  where brand_id = new.brand_id and document_type = new.document_type and is_test = new.is_test
  returning * into counter;
  if not found then
    raise exception 'no document counter for this brand' using errcode = 'CX004';
  end if;

  new.number := counter.last_number;
  new.display_number := counter.prefix || '-' || lpad(counter.last_number::text, 6, '0');
  new.status := 'issued';
  new.issued_at := now();
  new.voided_at := null;
  new.void_reason := null;
  return new;
end;
$$;

-- 3. What the reply review and the bot are shown about the quote now includes the tax: the bot may say that amount.

create or replace function core.deal_facts(p_conversation_id bigint) returns jsonb
  language plpgsql stable
  set search_path = ''
  as $$
declare
  conversation core.conversations;
  contact public.contacts;
  brand core.brands;
  deal public.deals;
  ref_deal public.deals;
  price_list core.price_lists;
  quote core.quotes;
  appointment core.appointments;
  v_phone text;
  v_offered jsonb;
begin
  select * into conversation from core.conversations where id = p_conversation_id;
  select * into contact from public.contacts where id = conversation.contact_id;
  select * into brand from core.brands where id = conversation.brand_id;
  select * into deal from public.deals
    where primary_contact_id = contact.id and stage not in ('won', 'lost') and archived_at is null
    order by id desc limit 1;
  -- After the sale closes there is no open opportunity, but the last one still describes the quote and the appointment.
  ref_deal := deal;
  if ref_deal.id is null then
    select * into ref_deal from public.deals where primary_contact_id = contact.id order by id desc limit 1;
  end if;
  select i.value into v_phone from core.contact_identities i
    where i.id = conversation.identity_id and i.type = 'phone_e164';

  select * into quote from core.quotes where deal_id = ref_deal.id and status = 'sent' order by version desc limit 1;
  select * into price_list from core.price_lists
    where id = coalesce(quote.price_list_id, core.active_price_list(brand.id));
  select * into appointment from core.appointments
    where deal_id = ref_deal.id and status in ('hold', 'confirmed')
    order by (status = 'confirmed') desc, start_at limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('start_at', o.start_at, 'end_at', o.end_at) order by o.start_at), '[]'::jsonb)
    into v_offered
    from core.offered_slots o
    where o.conversation_id = conversation.id and o.offered_at > now() - interval '1 day';

  return jsonb_build_object(
    'brand_id', brand.id,
    'timezone', brand.timezone,
    'language', contact.preferred_language,
    'allowed_reply_domains', to_jsonb(brand.allowed_reply_domains),
    'phone_e164', v_phone,
    'deal_id', deal.id,
    'stage', ref_deal.stage,
    'client_type', ref_deal.client_type,
    'zip', ref_deal.zip,
    'address', ref_deal.service_address,
    'space_type', ref_deal.service_space_type,
    'space_size', ref_deal.service_space_size,
    'currency', price_list.currency,
    'rates', case when price_list.id is null then null else jsonb_build_object(
      'covered', price_list.covered_rate,
      'uncovered', price_list.uncovered_rate,
      'discount_pct', price_list.discount_pct,
      'min_total', price_list.min_total,
      'confirmed', price_list.is_confirmed
    ) end,
    'quote', case when quote.id is null then null else jsonb_build_object(
      'version', quote.version,
      'covered_sqft', quote.covered_sqft,
      'uncovered_sqft', quote.uncovered_sqft,
      'subtotal', quote.subtotal,
      'discount', quote.discount,
      'total', quote.total,
      'min_applied', quote.min_applied,
      'discount_applied', quote.discount_applied,
      'tax_pct', quote.tax_pct,
      'tax', quote.tax,
      'price_confirmed', quote.price_confirmed,
      'covered_cost', round(quote.covered_sqft * price_list.covered_rate, 2),
      'uncovered_cost', round(quote.uncovered_sqft * price_list.uncovered_rate, 2)
    ) end,
    'appointment', case when appointment.id is null then null else jsonb_build_object(
      'status', appointment.status,
      'start_at', appointment.start_at,
      'end_at', appointment.end_at,
      'address', appointment.address,
      'hold_expires_at', appointment.hold_expires_at
    ) end,
    'offered_slots', v_offered
  );
end;
$$;
