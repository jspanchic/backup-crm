-- CRM-T9b: the editable calendar. Staff book, confirm, cancel and move appointments, and manage the
-- availability of each technician, through api functions called by core-api (the panel has no write access
-- to schema core). The rules are the ones of the bot: no clashes (the exclusion constraint), a booking starts
-- as a hold, one booking at a time per brand, and a confirmation needs an address and a sent quote.
-- Error codes as in 0012: CX002 invalid state, CX003 hold expired, CX004 invalid input, CX005 time taken.

-- Read side for the panel: technicians with their weekly windows and time off, in the brand's time zone.
create view public.technicians_summary as
select
  t.id,
  t.brand_id,
  t.name,
  t.active,
  b.timezone,
  coalesce((
    select jsonb_agg(
      jsonb_build_object('id', a.id, 'weekday', a.weekday, 'start', to_char(a.start_time, 'HH24:MI'), 'end', to_char(a.end_time, 'HH24:MI'))
      order by a.weekday, a.start_time)
    from core.technician_availability a
    where a.technician_id = t.id
  ), '[]'::jsonb) as availability,
  coalesce((
    select jsonb_agg(
      jsonb_build_object('id', o.id, 'from', lower(o.period), 'to', upper(o.period), 'reason', o.reason)
      order by lower(o.period))
    from core.technician_time_off o
    where o.technician_id = t.id and upper(o.period) > now() - interval '7 days'
  ), '[]'::jsonb) as time_off
from core.technicians t
join core.brands b on b.id = t.brand_id;

grant select on public.technicians_summary to crm_api;

-- The same view of one appointment, as the panel needs it after a change.
create function core.appointment_json(p_appointment core.appointments) returns jsonb
  language sql immutable
  set search_path = ''
  as $$
    select jsonb_build_object(
      'id', p_appointment.id,
      'estado', p_appointment.status,
      'tecnico_id', p_appointment.technician_id,
      'inicio', p_appointment.start_at,
      'fin', p_appointment.end_at,
      'vence_en', p_appointment.hold_expires_at
    )
  $$;

create function core.book_lock(p_brand_id bigint) returns void
  language sql
  set search_path = ''
  as $$ select pg_advisory_xact_lock(hashtext('book:' || p_brand_id)) $$;

-- Places a hold for staff. The caller has taken the brand lock.
create function core.staff_place_hold(p_deal_id bigint, p_technician_id bigint, p_start_at timestamptz, p_address text)
  returns core.appointments
  language plpgsql
  set search_path = ''
  as $$
declare
  v_deal public.deals;
  v_settings core.scheduling_settings;
  appointment core.appointments;
begin
  select * into v_deal from public.deals where id = p_deal_id;
  if not found then
    raise exception 'unknown opportunity' using errcode = 'CX004', hint = 'unknown_opportunity';
  end if;
  if v_deal.primary_contact_id is null then
    raise exception 'the opportunity has no primary contact' using errcode = 'CX004', hint = 'no_primary_contact';
  end if;
  if exists (select 1 from core.appointments where deal_id = v_deal.id and status = 'confirmed') then
    raise exception 'the service is already scheduled; cancel it first' using errcode = 'CX002', hint = 'already_scheduled';
  end if;
  if p_start_at <= now() then
    raise exception 'that time is in the past' using errcode = 'CX004', hint = 'in_the_past';
  end if;
  select * into v_settings from core.scheduling_settings where brand_id = v_deal.brand_id;
  if not found then
    raise exception 'no scheduling settings for this brand' using errcode = 'CX004', hint = 'no_settings';
  end if;
  -- Inside the technician's availability and outside the time off; the clashes are the constraint's job.
  if not exists (select 1 from core.slot_technicians(v_deal.brand_id, p_start_at) s(id) where s.id = p_technician_id) then
    raise exception 'that time is outside the availability of the technician' using errcode = 'CX004', hint = 'outside_availability';
  end if;

  update core.appointments set status = 'expired' where status = 'hold' and hold_expires_at <= now();
  -- A contact has one hold at a time: booking again replaces it.
  update core.appointments set status = 'cancelled' where contact_id = v_deal.primary_contact_id and status = 'hold';

  begin
    insert into core.appointments (deal_id, contact_id, technician_id, start_at, end_at, address)
    values (
      v_deal.id, v_deal.primary_contact_id, p_technician_id, p_start_at,
      p_start_at + make_interval(mins => v_settings.slot_minutes),
      coalesce(nullif(btrim(p_address), ''), v_deal.service_address)
    )
    returning * into appointment;
  exception when exclusion_violation then
    raise exception 'that time is taken' using errcode = 'CX005', hint = 'slot_taken';
  end;
  return appointment;
end;
$$;

-- Confirms a hold the way the bot does: it needs an address and a sent quote, and the sale is won.
create function core.staff_confirm_hold(p_appointment_id bigint) returns core.appointments
  language plpgsql
  set search_path = ''
  as $$
declare
  appointment core.appointments;
  v_deal public.deals;
begin
  select * into appointment from core.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'unknown appointment' using errcode = 'CX004', hint = 'unknown_appointment';
  end if;
  if appointment.status <> 'hold' then
    raise exception 'only a reserved time can be confirmed' using errcode = 'CX002', hint = 'not_a_hold';
  end if;
  select * into v_deal from public.deals where id = appointment.deal_id;
  if coalesce(nullif(btrim(appointment.address), ''), nullif(btrim(v_deal.service_address), '')) is null then
    raise exception 'the service address is required' using errcode = 'CX002', hint = 'address_required';
  end if;
  if not exists (select 1 from core.quotes where deal_id = appointment.deal_id and status = 'sent') then
    raise exception 'a quote is required' using errcode = 'CX002', hint = 'quote_required';
  end if;
  -- The trigger refuses a hold that ran out (CX003).
  update core.appointments
    set status = 'confirmed', address = coalesce(nullif(btrim(appointment.address), ''), v_deal.service_address)
    where id = appointment.id
    returning * into appointment;
  update public.deals set stage = 'won', updated_at = now() where id = appointment.deal_id;
  return appointment;
end;
$$;

-- Books a time for an opportunity. With p_confirm the hold is confirmed in the same transaction.
create function api.staff_book(p_deal_id bigint, p_technician_id bigint, p_start_at timestamptz, p_address text, p_confirm boolean)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_brand_id bigint;
  appointment core.appointments;
begin
  select brand_id into v_brand_id from public.deals where id = p_deal_id;
  if v_brand_id is null then
    raise exception 'unknown opportunity' using errcode = 'CX004', hint = 'unknown_opportunity';
  end if;
  perform core.book_lock(v_brand_id);
  appointment := core.staff_place_hold(p_deal_id, p_technician_id, p_start_at, p_address);
  if p_confirm then
    appointment := core.staff_confirm_hold(appointment.id);
  end if;
  return core.appointment_json(appointment);
end;
$$;

create function api.staff_confirm(p_appointment_id bigint) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  appointment core.appointments;
begin
  appointment := core.staff_confirm_hold(p_appointment_id);
  return core.appointment_json(appointment);
end;
$$;

create function api.staff_cancel(p_appointment_id bigint) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  appointment core.appointments;
begin
  select * into appointment from core.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'unknown appointment' using errcode = 'CX004', hint = 'unknown_appointment';
  end if;
  if appointment.status not in ('hold', 'confirmed') then
    raise exception 'only a reserved or confirmed appointment can be cancelled' using errcode = 'CX002', hint = 'not_cancellable';
  end if;
  update core.appointments set status = 'cancelled' where id = appointment.id returning * into appointment;
  return core.appointment_json(appointment);
end;
$$;

-- Moves an appointment: the old one is cancelled and the new one booked in one transaction, so if the new
-- time is taken nothing changes. A confirmed appointment stays confirmed; a hold gets a new hold.
create function api.staff_reschedule(p_appointment_id bigint, p_technician_id bigint, p_start_at timestamptz) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  old core.appointments;
  appointment core.appointments;
begin
  select * into old from core.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'unknown appointment' using errcode = 'CX004', hint = 'unknown_appointment';
  end if;
  if old.status not in ('hold', 'confirmed') then
    raise exception 'only a reserved or confirmed appointment can be moved' using errcode = 'CX002', hint = 'not_movable';
  end if;
  if old.technician_id = p_technician_id and old.start_at = p_start_at then
    raise exception 'the appointment is already at that time' using errcode = 'CX004', hint = 'same_time';
  end if;

  perform core.book_lock(old.brand_id);
  update core.appointments set status = 'cancelled' where id = old.id;
  appointment := core.staff_place_hold(old.deal_id, p_technician_id, p_start_at, old.address);
  if old.status = 'confirmed' then
    -- Same deal, same address, same quote: only the time changes. The deal stays won.
    update core.appointments set status = 'confirmed' where id = appointment.id returning * into appointment;
  end if;
  return core.appointment_json(appointment) || jsonb_build_object('reemplaza', old.id);
end;
$$;

-- Weekly windows of a technician, replaced as a whole: [{"weekday": 1, "start": "09:00", "end": "17:00"}].
-- Appointments already booked are not touched; the answer says how many fall outside the new windows.
create function api.set_availability(p_technician_id bigint, p_windows jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_technician core.technicians;
  v_windows jsonb;
  v_outside integer;
begin
  select * into v_technician from core.technicians where id = p_technician_id for update;
  if not found then
    raise exception 'unknown technician' using errcode = 'CX004', hint = 'unknown_technician';
  end if;
  if jsonb_typeof(p_windows) is distinct from 'array' then
    raise exception 'windows must be a list' using errcode = 'CX004', hint = 'bad_windows';
  end if;

  -- Normalised once: a malformed value (not an object, a weekday that is not a number, a time that is not a time) lands here.
  begin
    select coalesce(jsonb_agg(distinct jsonb_build_object('weekday', w.weekday, 'start', w."start"::time, 'end', w."end"::time)), '[]'::jsonb)
      into v_windows
      from jsonb_to_recordset(p_windows) as w(weekday smallint, "start" text, "end" text);
  exception when others then
    raise exception 'each window needs a weekday (0 to 6) and a start and end time' using errcode = 'CX004', hint = 'bad_windows';
  end;
  if exists (
    select 1 from jsonb_to_recordset(v_windows) as n(weekday smallint, "start" time, "end" time)
    where n.weekday is null or n.weekday not between 0 and 6 or n."end" <= n."start"
  ) then
    raise exception 'each window needs a weekday (0 to 6) and an end after its start' using errcode = 'CX004', hint = 'bad_windows';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(v_windows) as a(weekday smallint, "start" time, "end" time)
    join jsonb_to_recordset(v_windows) as b(weekday smallint, "start" time, "end" time)
      on a.weekday = b.weekday and (a."start", a."end") <> (b."start", b."end")
         and a."start" < b."end" and b."start" < a."end"
  ) then
    raise exception 'the windows of one day cannot overlap' using errcode = 'CX004', hint = 'overlapping_windows';
  end if;

  delete from core.technician_availability where technician_id = p_technician_id;
  insert into core.technician_availability (technician_id, weekday, start_time, end_time)
    select p_technician_id, n.weekday, n."start", n."end"
    from jsonb_to_recordset(v_windows) as n(weekday smallint, "start" time, "end" time);

  select count(*) into v_outside
  from core.appointments x
  where x.technician_id = p_technician_id and x.status in ('hold', 'confirmed') and x.start_at > now()
    and not exists (select 1 from core.slot_technicians(x.brand_id, x.start_at) s(id) where s.id = p_technician_id);
  return jsonb_build_object('ventanas', jsonb_array_length(v_windows), 'citas_fuera', v_outside);
end;
$$;

create function api.add_time_off(p_technician_id bigint, p_from timestamptz, p_to timestamptz, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_id bigint;
  v_conflicts integer;
begin
  if not exists (select 1 from core.technicians where id = p_technician_id) then
    raise exception 'unknown technician' using errcode = 'CX004', hint = 'unknown_technician';
  end if;
  if p_to <= p_from then
    raise exception 'the end must be after the start' using errcode = 'CX004', hint = 'bad_period';
  end if;
  insert into core.technician_time_off (technician_id, period, reason)
    values (p_technician_id, tstzrange(p_from, p_to, '[)'), nullif(btrim(p_reason), ''))
    returning id into v_id;
  select count(*) into v_conflicts from core.appointments x
    where x.technician_id = p_technician_id and x.status in ('hold', 'confirmed')
      and tstzrange(x.start_at, x.end_at, '[)') && tstzrange(p_from, p_to, '[)');
  return jsonb_build_object('id', v_id, 'citas_en_conflicto', v_conflicts);
end;
$$;

create function api.remove_time_off(p_time_off_id bigint) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  delete from core.technician_time_off where id = p_time_off_id;
  if not found then
    raise exception 'unknown time off' using errcode = 'CX004', hint = 'unknown_time_off';
  end if;
  return jsonb_build_object('id', p_time_off_id);
end;
$$;
