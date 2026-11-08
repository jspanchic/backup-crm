-- PRESENTATION: appointments, quotes and WhatsApp conversations of test leads (everything is_test through its deal and
-- contact). Quotes go through the real trigger, so every amount is calculated by the database. The PDFs are made by
-- `db-seed-presentacion` when the PDF engine is up. Safe to run again: each piece is skipped if it already exists.
do $$
declare
  v_tz text;
  v_channel bigint;
  v_days text[] := array['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  v_months text[] := array['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  v_slots timestamptz[];
  v_past timestamptz;
  r record;
  m record;
  v_contact public.contacts;
  v_deal public.deals;
  v_quote core.quotes;
  v_identity bigint;
  v_conv bigint;
  v_appt bigint;
  v_local timestamp;
  v_label text;
begin
  select timezone into v_tz from core.brands where id = 1;
  select id into v_channel from core.channels where identifier = 'bytogam-pruebas';
  if v_channel is null or not exists (select 1 from core.technicians where id = 1) then
    return;
  end if;

  -- The applicator is in Orlando: deals in Chicago go back to "Cotizado" and Orlando ones take the "Agendado" column.
  update public.deals set stage = 'proposal-sent'
  where stage = 'assessment' and is_test and primary_contact_id in (
    select id from public.contacts where phone_jsonb @> '[{"number": "+13125550113"}]'::jsonb
       or phone_jsonb @> '[{"number": "+13125550118"}]'::jsonb);

  -- The next free times of the applicator, on his own grid (service + travel): the first of each day, starting tomorrow.
  select array_agg(s.start_at order by s.start_at) into v_slots from (
    select distinct on (g.day) g.start_at from (
      select ((d::date + t::time) at time zone v_tz) as start_at, d::date as day
      from generate_series((now() at time zone v_tz)::date + 1, (now() at time zone v_tz)::date + 14, interval '1 day') d
      join core.technician_availability a on a.technician_id = 1 and a.weekday = extract(dow from d)
      cross join lateral generate_series(date '2000-01-01' + a.start_time, date '2000-01-01' + a.end_time - interval '60 minutes', interval '90 minutes') t
    ) g
    order by g.day, g.start_at
  ) s;
  -- And the latest one before today, for a visit that already happened.
  select ((d::date + g::time) at time zone v_tz) into v_past
    from generate_series((now() at time zone v_tz)::date - 14, (now() at time zone v_tz)::date - 1, interval '1 day') d
    join core.technician_availability a on a.technician_id = 1 and a.weekday = extract(dow from d)
    cross join lateral generate_series(date '2000-01-01' + a.start_time, date '2000-01-01' + a.end_time - interval '60 minutes', interval '90 minutes') g
    order by 1 desc limit 1;

  -- 1. Two Orlando businesses with a quote, a confirmed visit and a conversation.
  for r in
    select * from (values
      ('+14075550111', 1800, 4, 1,
       '[["in","client","Hola, buenas tardes. Tengo una cafetería en Orlando y quiero información para desinfectarla.",0],
         ["out","bot","Hola, soy Javier, tu asesor de Salvionix. ¿Con quién tengo el gusto?",1],
         ["in","client","Soy María Fernández, de Café Aroma. El local tiene unos 1.800 pies cuadrados.",4],
         ["out","bot","Mucho gusto, María. Con esos datos te preparo una cotización.",5],
         ["out","bot","Te envié la cotización en PDF. ¿Quieres que agendemos una visita?",7],
         ["in","client","Sí, ¿cuándo pueden ir?",12],
         ["out","bot","Tengo libre el {slot}. ¿Te sirve?",13],
         ["in","client","Sí, ese día me sirve.",16],
         ["out","bot","Listo, quedó agendado para el {slot}. Te envío la orden de compra para que la confirmes.",17]]'),
      ('+14075550117', 2400, 3, 3,
       '[["in","client","Buenas, ¿cuánto cuesta desinfectar una guardería de 2.400 pies?",0],
         ["out","bot","Hola, soy Javier, de Salvionix. ¿Con quién tengo el gusto?",1],
         ["in","client","Patricia Nguyen, de Little Stars Daycare.",3],
         ["out","bot","Mucho gusto, Patricia. Te envié la cotización en PDF. ¿Quieres que agendemos una visita?",5],
         ["in","client","Sí, ¿qué día tienen?",9],
         ["out","bot","Tengo libre el {slot}. ¿Te sirve?",10],
         ["in","client","Perfecto, ese.",12],
         ["out","bot","Listo, quedó agendado para el {slot}.",13],
         ["out","human","Hola Patricia, soy del equipo de Salvionix. Cualquier duda sobre la visita me escribes por aquí.",45]]')
    ) as t(phone, covered_sqft, days_ago, slot_no, messages)
  loop
    select * into v_contact from public.contacts where is_test and phone_jsonb @> jsonb_build_array(jsonb_build_object('number', r.phone));
    continue when v_contact.id is null or v_slots is null or array_length(v_slots, 1) < r.slot_no;
    select * into v_deal from public.deals where primary_contact_id = v_contact.id order by id limit 1;

    if not exists (select 1 from core.quotes where deal_id = v_deal.id) then
      insert into core.quotes (deal_id, covered_sqft, uncovered_sqft, inputs, valid_until)
      values (v_deal.id, r.covered_sqft, 0, jsonb_build_object('client_type', 'business', 'covered_sqft', r.covered_sqft), current_date + 15)
      returning * into v_quote;
      update public.deals set amount = v_quote.total where id = v_deal.id;
    end if;

    if not exists (select 1 from core.appointments where deal_id = v_deal.id) then
      insert into core.appointments (deal_id, contact_id, technician_id, start_at, end_at, address)
      values (v_deal.id, v_contact.id, 1, v_slots[r.slot_no], v_slots[r.slot_no] + interval '60 minutes', v_deal.service_address)
      returning id into v_appt;
      update core.appointments set status = 'confirmed' where id = v_appt;
    end if;
    update public.deals set stage = 'assessment' where id = v_deal.id and stage = 'proposal-sent';

    if not exists (select 1 from core.conversations where contact_id = v_contact.id) then
      insert into core.contact_identities (brand_id, type, value, last_inbound_at, last_verified_at)
      values (1, 'phone_e164', r.phone, now() - make_interval(days => r.days_ago) + interval '16 minutes', now() - make_interval(days => r.days_ago))
      on conflict (brand_id, type, value) do update set last_inbound_at = excluded.last_inbound_at
      returning id into v_identity;
      insert into core.identity_holders (identity_id, contact_id, valid_from)
      values (v_identity, v_contact.id, now() - make_interval(days => r.days_ago) - interval '1 hour')
      on conflict do nothing;
      insert into core.conversations (brand_id, channel_id, identity_id, contact_id, opened_at)
      values (1, v_channel, v_identity, v_contact.id, now() - make_interval(days => r.days_ago))
      returning id into v_conv;

      v_local := v_slots[r.slot_no] at time zone v_tz;
      v_label := v_days[extract(dow from v_local)::int + 1] || ' ' || extract(day from v_local)::int || ' de '
                 || v_months[extract(month from v_local)::int] || ' a las ' || to_char(v_local, 'HH24:MI');
      for m in select e ->> 0 as direction, e ->> 1 as sender, e ->> 2 as body, (e ->> 3)::int as minute
               from jsonb_array_elements(r.messages::jsonb) e
      loop
        insert into core.messages (brand_id, conversation_id, channel_id, direction, sender, body, sent_at, bot_dispatched_at)
        values (1, v_conv, v_channel, m.direction, m.sender, replace(m.body, '{slot}', v_label),
                now() - make_interval(days => r.days_ago) + make_interval(mins => m.minute),
                case when m.direction = 'in' then now() - make_interval(days => r.days_ago) + make_interval(mins => m.minute) end);
      end loop;
    end if;
  end loop;

  -- 2. A visit that already happened (Elena Torres, deal won).
  select * into v_contact from public.contacts where is_test and phone_jsonb @> '[{"number": "+14075550121"}]'::jsonb;
  if v_contact.id is not null and v_past is not null then
    select * into v_deal from public.deals where primary_contact_id = v_contact.id order by id limit 1;
    if not exists (select 1 from core.appointments where deal_id = v_deal.id) then
      insert into core.appointments (deal_id, contact_id, technician_id, start_at, end_at, address)
      values (v_deal.id, v_contact.id, 1, v_past, v_past + interval '60 minutes', v_deal.service_address)
      returning id into v_appt;
      update core.appointments set status = 'confirmed' where id = v_appt;
      update core.appointments set status = 'done' where id = v_appt;
    end if;
  end if;
end
$$;