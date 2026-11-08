-- Production availability is dated in each technician's local zone. Weekly rows remain for legacy agendas.
alter table core.technicians
  add column timezone text,
  add column zip_prefixes text[] check (
    array_position(zip_prefixes, null) is null and array_to_string(zip_prefixes, ',') ~ '^[0-9]{1,5}(,[0-9]{1,5})*$'
  );

create table core.technician_dated_availability (
  technician_id bigint not null references core.technicians (id),
  service_date date not null,
  start_time time not null,
  end_time time not null,
  primary key (technician_id, service_date, start_time),
  check (end_time > start_time),
  exclude using gist (
    technician_id with =,
    tsrange(service_date + start_time, service_date + end_time, '[)') with &&
  )
);

alter table core.offered_slots add column service_zip text;

create function core.uses_dated_availability(p_brand_id bigint) returns boolean
  language sql stable
  set search_path = ''
  as $$
    select exists (
      select 1 from core.technicians where brand_id = p_brand_id and zip_prefixes is not null
    ) or exists (
      select 1 from core.channels
      where brand_id = p_brand_id and provider = 'waha' and identifier = 'salvionix' and not is_test
    )
  $$;

create function core.zip_covered(p_zip text, p_prefixes text[]) returns boolean
  language sql immutable
  set search_path = ''
  as $$
    select exists (
      select 1 from unnest(p_prefixes) prefix
      where p_zip ~ '^[0-9]{5}(-[0-9]{4})?$' and left(p_zip, length(prefix)) = prefix
    )
  $$;

-- Serialize offers and reservations with updates to imported availability and with each other.
-- The brand row lock also makes switching the agenda off atomic with these actions.
create function core.require_bot_agenda(p_conversation_id bigint) returns core.brands
  language plpgsql
  set search_path = ''
  as $$
declare
  v_brand_id bigint;
  brand core.brands;
begin
  select brand_id into v_brand_id from core.conversations where id = p_conversation_id;
  if not found then
    raise exception 'unknown conversation' using errcode = 'CX004';
  end if;
  perform core.book_lock(v_brand_id);
  select * into brand from core.brands where id = v_brand_id for share;
  if not brand.bot_agenda_enabled then
    raise exception 'agenda_apagada' using errcode = 'CX008';
  end if;
  -- Contact updates lock the conversation before changing its deal.
  perform 1 from core.conversations where id = p_conversation_id for key share;
  return brand;
end;
$$;

-- Staff uses this same lookup to place holds. Legacy windows fit only the service; dated
-- windows must accommodate both the service and the trip. Neither may intersect time off.
create or replace function core.slot_technicians(p_brand_id bigint, p_start_at timestamptz) returns setof bigint
  language sql stable
  set search_path = ''
  as $$
    select t.id
    from core.technicians t
    join core.brands b on b.id = t.brand_id
    join core.scheduling_settings s on s.brand_id = t.brand_id
    cross join lateral (
      select coalesce(t.timezone, b.timezone) as zone,
             make_interval(mins => s.slot_minutes + case when t.zip_prefixes is not null then s.buffer_minutes else 0 end) as duration
    ) cfg
    cross join lateral (
      select p_start_at at time zone cfg.zone as local_start,
             (p_start_at + cfg.duration) at time zone cfg.zone as local_end
    ) l
    where t.brand_id = p_brand_id
      and t.active
      and l.local_end::date = l.local_start::date
      and (
        (t.zip_prefixes is null and exists (
          select 1 from core.technician_availability a
          where a.technician_id = t.id and a.weekday = extract(dow from l.local_start)
            and a.start_time <= l.local_start::time and a.end_time >= l.local_end::time
        ))
        or (t.zip_prefixes is not null and exists (
          select 1 from core.technician_dated_availability a
          where a.technician_id = t.id and a.service_date = l.local_start::date
            and p_start_at >= (a.service_date + a.start_time) at time zone cfg.zone
            and p_start_at + cfg.duration <= (a.service_date + a.end_time) at time zone cfg.zone
        ))
      )
      and not exists (
        select 1 from core.technician_time_off o
        where o.technician_id = t.id and o.period && tstzrange(p_start_at, p_start_at + cfg.duration, '[)')
      )
    order by t.id
  $$;

create function core.dated_free_slots(p_conversation_id bigint, p_from date, p_days integer, p_zip text)
  returns table (start_at timestamptz, end_at timestamptz)
  language sql stable
  set search_path = ''
  as $$
    with candidates as (
      select t.id as technician_id, c.contact_id, b.timezone as brand_timezone,
             g.slot_start,
             make_interval(mins => s.slot_minutes) as service,
             make_interval(mins => s.slot_minutes + s.buffer_minutes) as occupied,
             s.min_notice_minutes, s.horizon_days
      from core.conversations c
      join core.brands b on b.id = c.brand_id
      join core.scheduling_settings s on s.brand_id = c.brand_id
      join core.technicians t on t.brand_id = c.brand_id and t.active and core.zip_covered(p_zip, t.zip_prefixes)
      join core.technician_dated_availability a on a.technician_id = t.id
      cross join lateral (select coalesce(t.timezone, b.timezone) as name) zone
      cross join lateral generate_series(
        (a.service_date + a.start_time) at time zone zone.name,
        ((a.service_date + a.end_time) at time zone zone.name) - make_interval(mins => s.slot_minutes + s.buffer_minutes),
        make_interval(mins => s.slot_minutes + s.buffer_minutes)
      ) as g(slot_start)
      where c.id = p_conversation_id
        -- Technician dates can be ahead of or behind the requested brand dates.
        and a.service_date between p_from - 2 and p_from + p_days + 1
    )
    select distinct c.slot_start, c.slot_start + c.service
    from candidates c
    where (c.slot_start at time zone c.brand_timezone)::date >= p_from
      and (c.slot_start at time zone c.brand_timezone)::date < p_from + p_days
      and c.slot_start >= now() + make_interval(mins => c.min_notice_minutes)
      and c.slot_start < now() + make_interval(days => c.horizon_days)
      and not exists (
        select 1 from core.technician_time_off o
        where o.technician_id = c.technician_id
          and o.period && tstzrange(c.slot_start, c.slot_start + c.occupied, '[)')
      )
      and not exists (
        select 1 from core.appointments x
        where x.technician_id = c.technician_id
          and x.status not in ('cancelled', 'expired') and not x.is_test
          and not (x.status = 'hold' and (x.hold_expires_at <= now() or x.contact_id = c.contact_id))
          and tstzrange(x.start_at, x.blocked_until, '[)') && tstzrange(c.slot_start, c.slot_start + c.occupied, '[)')
      )
    order by 1
    limit 3
  $$;

create function api.free_slots(p_conversation_id bigint, p_from date, p_days integer, p_zip text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  brand core.brands := core.require_bot_agenda(p_conversation_id);
  settings core.scheduling_settings;
  facts jsonb;
  v_today date;
  v_from date;
  v_days integer;
  v_deal_id bigint;
  v_zip text;
  v_slots jsonb;
begin
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

  if core.uses_dated_availability(brand.id) then
    facts := core.deal_facts(p_conversation_id);
    v_deal_id := (facts ->> 'deal_id')::bigint;
    select zip into v_zip from public.deals where id = v_deal_id for update;
    v_zip := coalesce(p_zip, v_zip);
    if v_zip is null or v_zip !~ '^[0-9]{5}(-[0-9]{4})?$' then
      raise exception 'ZIP del servicio requerido (5 dígitos o ZIP+4)' using errcode = 'CX004';
    end if;
    if p_zip is not null then
      update public.deals set zip = p_zip where id = v_deal_id and zip is distinct from p_zip;
    end if;

    -- Slots offered for another ZIP cannot be reused or mentioned in this conversation.
    delete from core.offered_slots where conversation_id = p_conversation_id and service_zip is distinct from v_zip;
    if not exists (
      select 1 from core.technicians t
      where t.brand_id = brand.id and t.active and core.zip_covered(v_zip, t.zip_prefixes)
    ) then
      delete from core.offered_slots where conversation_id = p_conversation_id;
      return jsonb_build_object('zona_horaria', brand.timezone, 'fuera_de_cobertura', true, 'horarios', '[]'::jsonb);
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('inicio', f.start_at, 'fin', f.end_at) order by f.start_at), '[]'::jsonb)
      into v_slots from core.dated_free_slots(p_conversation_id, v_from, v_days, v_zip) f;
  else
    select coalesce(jsonb_agg(jsonb_build_object('inicio', f.start_at, 'fin', f.end_at) order by f.start_at), '[]'::jsonb)
      into v_slots from core.free_slot_list(p_conversation_id, v_from, v_days, 12) f;
  end if;

  insert into core.offered_slots (conversation_id, start_at, end_at, service_zip)
  select p_conversation_id, (e ->> 'inicio')::timestamptz, (e ->> 'fin')::timestamptz, v_zip
  from jsonb_array_elements(v_slots) e
  on conflict (conversation_id, start_at) do update
    set offered_at = now(), end_at = excluded.end_at, service_zip = excluded.service_zip;

  return jsonb_build_object('zona_horaria', brand.timezone, 'horarios', v_slots);
end;
$$;

create or replace function api.free_slots(p_conversation_id bigint, p_from date, p_days integer) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$
    select api.free_slots(p_conversation_id, p_from, p_days, null::text)
  $$;

-- Recheck the service ZIP and dated coverage at reservation and confirmation.
create or replace function api.hold_slot(p_conversation_id bigint, p_start_at timestamptz) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  brand core.brands := core.require_bot_agenda(p_conversation_id);
  conversation core.conversations;
  settings core.scheduling_settings;
  facts jsonb := core.deal_facts(p_conversation_id);
  v_deal_id bigint := (facts ->> 'deal_id')::bigint;
  v_technician_id bigint;
  v_zip text;
  v_dated boolean := core.uses_dated_availability(brand.id);
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

  if v_dated then
    select zip into v_zip from public.deals where id = v_deal_id for update;
  end if;

  if not exists (
    select 1 from core.offered_slots
    where conversation_id = p_conversation_id and start_at = p_start_at and offered_at > now() - interval '1 day'
      and (not v_dated or (v_zip is not null and service_zip = v_zip))
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

  for v_technician_id in
    select t.id
    from core.slot_technicians(brand.id, p_start_at) eligible(id)
    join core.technicians t on t.id = eligible.id
    where not v_dated or core.zip_covered(v_zip, t.zip_prefixes)
    order by t.id
  loop
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

create or replace function api.confirm_hold(p_conversation_id bigint, p_expected_start timestamptz, p_message text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  brand core.brands := core.require_bot_agenda(p_conversation_id);
  facts jsonb := core.deal_facts(p_conversation_id);
  v_deal_id bigint := (facts ->> 'deal_id')::bigint;
  appointment core.appointments;
  v_zip text;
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
  select zip into v_zip from public.deals where id = v_deal_id for update;
  if (facts ->> 'address') is null then
    raise exception 'the service address is required' using errcode = 'CX002';
  end if;
  -- A missing quote is a JSON null, not a SQL null.
  if jsonb_typeof(facts -> 'quote') is distinct from 'object' then
    raise exception 'a quote is required' using errcode = 'CX002';
  end if;

  if appointment.hold_expires_at <= now() then
    raise exception 'hold expired' using errcode = 'CX003';
  end if;
  if core.uses_dated_availability(brand.id) and not exists (
    select 1
    from core.slot_technicians(brand.id, appointment.start_at) eligible(id)
    join core.technicians t on t.id = eligible.id
    where t.id = appointment.technician_id and core.zip_covered(v_zip, t.zip_prefixes)
  ) then
    raise exception 'that time is no longer available for the service ZIP' using errcode = 'CX005';
  end if;

  -- The trigger also checks hold expiry and rolls everything back if the hold has expired.
  update core.appointments set status = 'confirmed', address = facts ->> 'address' where id = appointment.id;
  update public.deals set stage = 'won', updated_at = now() where id = v_deal_id;
  perform api.enqueue_outbound(p_conversation_id, p_message, 'bot', null);

  return jsonb_build_object('inicio', appointment.start_at, 'fin', appointment.end_at);
end;
$$;
