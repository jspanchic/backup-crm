-- Expose dated availability to the loopback panel without exposing technician phone numbers.
create or replace view public.technicians_summary as
select
  t.id,
  t.brand_id,
  t.name,
  t.active,
  coalesce(t.timezone, b.timezone) as timezone,
  coalesce((
    select jsonb_agg(
      jsonb_build_object('id', a.id, 'weekday', a.weekday, 'start', to_char(a.start_time, 'HH24:MI'), 'end', to_char(a.end_time, 'HH24:MI'))
      order by a.weekday, a.start_time)
    from core.technician_availability a
    where a.technician_id = t.id and t.zip_prefixes is null
  ), '[]'::jsonb) as availability,
  coalesce((
    select jsonb_agg(
      jsonb_build_object('id', o.id, 'from', lower(o.period), 'to', upper(o.period), 'reason', o.reason)
      order by lower(o.period))
    from core.technician_time_off o
    where o.technician_id = t.id and upper(o.period) > now() - interval '7 days'
  ), '[]'::jsonb) as time_off,
  t.zip_prefixes is not null as uses_dated_availability,
  coalesce((
    select jsonb_agg(
      jsonb_build_object('date', a.service_date, 'start', to_char(a.start_time, 'HH24:MI'), 'end', to_char(a.end_time, 'HH24:MI'))
      order by a.service_date, a.start_time)
    from core.technician_dated_availability a
    where a.technician_id = t.id and a.service_date >= (now() at time zone coalesce(t.timezone, b.timezone))::date - 7
  ), '[]'::jsonb) as dated_availability
from core.technicians t
join core.brands b on b.id = t.brand_id;

create function api.panel_operator_active(p_sub uuid) returns boolean
  language sql stable
  security definer
  set search_path = ''
  as $$
    select exists (select 1 from public.sales where user_id = p_sub and not disabled);
  $$;

-- The caller edits a single local date. The import and customer booking take the same brand lock.
create function api.set_dated_availability(p_technician_id bigint, p_date date, p_windows jsonb) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_brand_id bigint;
  v_timezone text;
  v_occupied_for interval;
  v_outside integer;
begin
  select brand_id into v_brand_id from core.technicians where id = p_technician_id;
  if not found then
    raise exception 'unknown technician' using errcode = 'CX004', hint = 'unknown_technician';
  end if;
  perform core.book_lock(v_brand_id);

  select coalesce(t.timezone, b.timezone), make_interval(mins => s.slot_minutes + s.buffer_minutes)
    into v_timezone, v_occupied_for
  from core.technicians t
  join core.brands b on b.id = t.brand_id
  join core.scheduling_settings s on s.brand_id = t.brand_id
  where t.id = p_technician_id and t.active and t.zip_prefixes is not null;
  if not found then
    raise exception 'dated availability is not enabled for this technician' using errcode = 'CX004', hint = 'bad_windows';
  end if;
  if p_date is null or p_date < (now() at time zone v_timezone)::date
      or jsonb_typeof(p_windows) is distinct from 'array' then
    raise exception 'a current or future local date and windows are required' using errcode = 'CX004', hint = 'bad_windows';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_windows) as w("start" time, "end" time)
    cross join lateral (
      select (p_date + w."start") at time zone v_timezone as starts_at,
             (p_date + w."end") at time zone v_timezone as ends_at
    ) as t
    where w."start" is null or w."end" is null or w."end" <= w."start"
      or t.starts_at <= now() or t.ends_at - t.starts_at < v_occupied_for
      or t.starts_at at time zone v_timezone <> p_date + w."start"
      or t.ends_at at time zone v_timezone <> p_date + w."end"
  ) then
    raise exception 'each window must be future and fit the service and travel' using errcode = 'CX004', hint = 'bad_windows';
  end if;

  begin
    delete from core.technician_dated_availability
    where technician_id = p_technician_id and service_date = p_date;
    insert into core.technician_dated_availability (technician_id, service_date, start_time, end_time)
      select p_technician_id, p_date, w."start", w."end"
      from jsonb_to_recordset(p_windows) as w("start" time, "end" time);
  exception when exclusion_violation or unique_violation then
    raise exception 'the windows of one date cannot overlap' using errcode = 'CX004', hint = 'overlapping_windows';
  end;

  select count(*) into v_outside
  from core.appointments x
  where x.technician_id = p_technician_id and x.start_at > now()
    and (x.status = 'confirmed' or (x.status = 'hold' and x.hold_expires_at > now()))
    and (x.start_at at time zone v_timezone)::date = p_date
    and not exists (
      select 1 from core.technician_dated_availability w
      where w.technician_id = x.technician_id and w.service_date = p_date
        and (p_date + w.start_time) at time zone v_timezone <= x.start_at
        and (p_date + w.end_time) at time zone v_timezone >= x.blocked_until
    );
  return jsonb_build_object('ventanas', jsonb_array_length(p_windows), 'citas_fuera', v_outside);
end;
$$;

create function api.block_technician(p_technician_id bigint, p_from timestamptz, p_to timestamptz, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  perform core.book_lock(brand_id) from core.technicians where id = p_technician_id;
  return api.add_time_off(p_technician_id, p_from, p_to, p_reason);
end;
$$;

-- The operator can free a provisional reservation. Confirmed appointments retain their status.
create function api.release_live_hold(p_appointment_id bigint) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_appointment core.appointments;
begin
  perform core.book_lock(brand_id) from core.appointments where id = p_appointment_id;
  select * into v_appointment from core.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'unknown appointment' using errcode = 'CX004', hint = 'unknown_appointment';
  end if;
  if v_appointment.status <> 'hold' then
    raise exception 'only a hold can be released' using errcode = 'CX002', hint = 'not_cancellable';
  end if;
  if v_appointment.hold_expires_at <= now() then
    raise exception 'hold expired' using errcode = 'CX003';
  end if;
  return api.staff_cancel(p_appointment_id);
end;
$$;
