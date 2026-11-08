-- The confirmation text uses the chat of the message that triggered the bot turn.
create function api.confirm_hold(
  p_conversation_id bigint, p_expected_start timestamptz, p_message text, p_inbound_message_id bigint
) returns jsonb
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
  perform api.enqueue_outbound(p_conversation_id, p_message, 'bot', null, p_inbound_message_id);

  return jsonb_build_object('inicio', appointment.start_at, 'fin', appointment.end_at);
end;
$$;

create or replace function api.confirm_hold(p_conversation_id bigint, p_expected_start timestamptz, p_message text) returns jsonb
  language sql
  security definer
  set search_path = ''
  as $$
    select api.confirm_hold(p_conversation_id, p_expected_start, p_message, null::bigint)
  $$;
