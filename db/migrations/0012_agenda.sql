-- Agenda: free slots, holds and confirmation. Error codes: CX005 slot taken, CX006 slot not offered.

-- Every slot that "horarios_libres" showed in a conversation. The bot may only reserve, and
-- (through the reply review) only mention, times that appear here.
create table core.offered_slots (
  conversation_id bigint not null references core.conversations (id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  offered_at timestamptz not null default now(),
  primary key (conversation_id, start_at)
);

-- Technicians that can take a slot starting at p_start_at, by availability and time off.
-- It does not look at other appointments: that is the job of the exclusion constraint.
create function core.slot_technicians(p_brand_id bigint, p_start_at timestamptz) returns setof bigint
  language sql stable
  set search_path = ''
  as $$
    select t.id
    from core.technicians t
    join core.brands b on b.id = t.brand_id
    join core.scheduling_settings s on s.brand_id = t.brand_id
    cross join lateral (select p_start_at at time zone b.timezone as local_start) l
    where t.brand_id = p_brand_id
      and t.active
      -- the whole slot is inside one local day and inside one availability window
      and (l.local_start + make_interval(mins => s.slot_minutes))::date = l.local_start::date
      and exists (
        select 1 from core.technician_availability a
        where a.technician_id = t.id
          and a.weekday = extract(dow from l.local_start)
          and a.start_time <= l.local_start::time
          and a.end_time >= (l.local_start + make_interval(mins => s.slot_minutes))::time
      )
      and not exists (
        select 1 from core.technician_time_off o
        where o.technician_id = t.id
          and o.period && tstzrange(p_start_at, p_start_at + make_interval(mins => s.slot_minutes), '[)')
      )
    order by t.id
  $$;

-- Free slots for one conversation. A slot is free when at least one technician can take it.
-- Marks as free: cancelled and expired appointments, holds past their time (not yet swept),
-- test appointments, and the customer's own hold (booking again replaces it).
create function core.free_slot_list(p_conversation_id bigint, p_from date, p_days integer, p_limit integer)
  returns table (start_at timestamptz, end_at timestamptz)
  language sql stable
  set search_path = ''
  as $$
    with conversation as (
      select c.id, c.brand_id, c.contact_id from core.conversations c where c.id = p_conversation_id
    ), settings as (
      select s.*, b.timezone from core.scheduling_settings s join core.brands b on b.id = s.brand_id
      join conversation c on c.brand_id = s.brand_id
    ), candidates as (
      select t.id as technician_id,
             ((d::date + series.local_time) at time zone s.timezone) as slot_start,
             s.slot_minutes, s.buffer_minutes
      from settings s
      cross join generate_series(p_from::timestamp, (p_from + (p_days - 1))::timestamp, interval '1 day') d
      join core.technicians t on t.brand_id = s.brand_id and t.active
      join core.technician_availability a on a.technician_id = t.id and a.weekday = extract(dow from d)
      cross join lateral (
        select g::time as local_time
        from generate_series(
          date '2000-01-01' + a.start_time,
          date '2000-01-01' + a.end_time - make_interval(mins => s.slot_minutes),
          make_interval(mins => s.slot_minutes + s.buffer_minutes)
        ) g
      ) series
    )
    select distinct c.slot_start, c.slot_start + make_interval(mins => c.slot_minutes)
    from candidates c, conversation cv, settings s
    where c.slot_start >= now() + make_interval(mins => s.min_notice_minutes)
      and c.slot_start < now() + make_interval(days => s.horizon_days)
      and not exists (
        select 1 from core.technician_time_off o
        where o.technician_id = c.technician_id
          and o.period && tstzrange(c.slot_start, c.slot_start + make_interval(mins => c.slot_minutes), '[)')
      )
      and not exists (
        select 1 from core.appointments x
        where x.technician_id = c.technician_id
          and x.status not in ('cancelled', 'expired')
          and not x.is_test
          and not (x.status = 'hold' and x.hold_expires_at <= now())
          and not (x.status = 'hold' and x.contact_id = cv.contact_id)
          and tstzrange(x.start_at, x.blocked_until, '[)')
              && tstzrange(c.slot_start, c.slot_start + make_interval(mins => c.slot_minutes + c.buffer_minutes), '[)')
      )
    order by 1
    limit p_limit
  $$;

-- `horarios_libres`
create function api.free_slots(p_conversation_id bigint, p_from date, p_days integer) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  conversation core.conversations;
  brand core.brands;
  settings core.scheduling_settings;
  v_today date;
  v_from date;
  v_days integer;
  v_slots jsonb;
begin
  select * into conversation from core.conversations where id = p_conversation_id;
  select * into brand from core.brands where id = conversation.brand_id;
  select * into settings from core.scheduling_settings where brand_id = brand.id;
  if not found then
    raise exception 'no scheduling settings for this brand' using errcode = 'CX004';
  end if;

  v_today := (now() at time zone brand.timezone)::date;
  v_from := greatest(coalesce(p_from, v_today), v_today);
  v_days := least(coalesce(p_days, 7), settings.horizon_days);
  if v_days < 1 then
    raise exception 'days must be at least 1' using errcode = 'CX004';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('inicio', f.start_at, 'fin', f.end_at) order by f.start_at), '[]'::jsonb)
    into v_slots
    from core.free_slot_list(p_conversation_id, v_from, v_days, 12) f;

  insert into core.offered_slots (conversation_id, start_at, end_at)
  select p_conversation_id, (e ->> 'inicio')::timestamptz, (e ->> 'fin')::timestamptz
  from jsonb_array_elements(v_slots) e
  on conflict (conversation_id, start_at) do update set offered_at = now(), end_at = excluded.end_at;

  return jsonb_build_object('zona_horaria', brand.timezone, 'horarios', v_slots);
end;
$$;

-- Marks as expired every hold that ran out. Safe to run any time; the booking function does it too.
create function api.expire_holds() returns integer
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_count integer;
begin
  with expired as (
    update core.appointments set status = 'expired'
    where status = 'hold' and hold_expires_at <= now()
    returning id
  )
  select count(*) into v_count from expired;
  return v_count;
end;
$$;

-- `reservar`: a hold of hold_minutes. All in one transaction, in this order:
--   1. the time must have been offered to this conversation, and still be allowed
--   2. holds that ran out are marked expired (the exclusion cannot look at the clock)
--   3. the customer's previous hold, if any, is released
--   4. the first technician who can take it is tried; a clash moves to the next one
create function api.hold_slot(p_conversation_id bigint, p_start_at timestamptz) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  conversation core.conversations;
  settings core.scheduling_settings;
  facts jsonb := core.deal_facts(p_conversation_id);
  v_deal_id bigint := (facts ->> 'deal_id')::bigint;
  v_technician_id bigint;
  appointment core.appointments;
begin
  if v_deal_id is null then
    raise exception 'no open opportunity' using errcode = 'CX002';
  end if;
  if facts -> 'appointment' ->> 'status' = 'confirmed' then
    raise exception 'the service is already scheduled' using errcode = 'CX002';
  end if;
  select * into conversation from core.conversations where id = p_conversation_id;
  select * into settings from core.scheduling_settings where brand_id = conversation.brand_id;

  if not exists (
    select 1 from core.offered_slots
    where conversation_id = p_conversation_id and start_at = p_start_at and offered_at > now() - interval '1 day'
  ) then
    raise exception 'that time was not offered in this conversation' using errcode = 'CX006';
  end if;
  if p_start_at < now() + make_interval(mins => settings.min_notice_minutes)
     or p_start_at >= now() + make_interval(days => settings.horizon_days) then
    raise exception 'that time is no longer available' using errcode = 'CX005';
  end if;

  update core.appointments set status = 'expired' where status = 'hold' and hold_expires_at <= now();
  update core.appointments set status = 'cancelled'
    where contact_id = conversation.contact_id and status = 'hold';

  for v_technician_id in select * from core.slot_technicians(conversation.brand_id, p_start_at) loop
    begin
      insert into core.appointments (deal_id, contact_id, technician_id, start_at, end_at, address)
      values (
        v_deal_id, conversation.contact_id, v_technician_id, p_start_at,
        p_start_at + make_interval(mins => settings.slot_minutes), facts ->> 'address'
      )
      returning * into appointment;
      exit;
    exception when exclusion_violation then
      appointment := null;
    end;
  end loop;

  if appointment.id is null then
    raise exception 'that time is no longer available' using errcode = 'CX005';
  end if;
  return jsonb_build_object('inicio', appointment.start_at, 'fin', appointment.end_at, 'vence_en', appointment.hold_expires_at);
end;
$$;

-- `confirmar`: turns the customer's live hold into a confirmed appointment, closes the sale and queues
-- the confirmation message in the same transaction. p_expected_start makes sure the message
-- says the same time as the appointment that is really confirmed.
create function api.confirm_hold(p_conversation_id bigint, p_expected_start timestamptz, p_message text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  facts jsonb := core.deal_facts(p_conversation_id);
  v_deal_id bigint := (facts ->> 'deal_id')::bigint;
  appointment core.appointments;
begin
  if v_deal_id is null then
    raise exception 'no open opportunity' using errcode = 'CX002';
  end if;
  select * into appointment from core.appointments
    where deal_id = v_deal_id and status = 'hold' order by id desc limit 1 for update;
  if not found then
    raise exception 'there is no reserved time to confirm' using errcode = 'CX002';
  end if;
  if appointment.start_at is distinct from p_expected_start then
    raise exception 'the reserved time changed' using errcode = 'CX002';
  end if;
  if (facts ->> 'address') is null then
    raise exception 'the service address is required' using errcode = 'CX002';
  end if;
  -- A missing quote is a JSON null, not a SQL null.
  if jsonb_typeof(facts -> 'quote') is distinct from 'object' then
    raise exception 'a quote is required' using errcode = 'CX002';
  end if;

  -- The trigger refuses an expired hold (CX003) and rolls everything back.
  update core.appointments set status = 'confirmed', address = facts ->> 'address' where id = appointment.id;
  update public.deals set stage = 'won', updated_at = now() where id = v_deal_id;
  perform api.enqueue_outbound(p_conversation_id, p_message, 'bot', null);

  return jsonb_build_object('inicio', appointment.start_at, 'fin', appointment.end_at);
end;
$$;

-- Facts for the reply review: what the bot has been shown in this conversation.
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
