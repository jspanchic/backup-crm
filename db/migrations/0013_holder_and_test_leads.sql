-- Numbers that change owner, and "Prueba X" leads.

-- The message that opened the question "is this still the same person?": the latest incoming message
-- that arrived after more than reverify_after_days of silence on this number. NULL when nothing is pending,
-- which includes the case where somebody already answered it.
create function core.reverify_gap_message(p_conversation_id bigint) returns core.messages
  language plpgsql stable
  set search_path = ''
  as $$
declare
  conversation core.conversations;
  identity core.contact_identities;
  settings core.scheduling_settings;
  gap core.messages;
begin
  select * into conversation from core.conversations where id = p_conversation_id;
  select * into identity from core.contact_identities where id = conversation.identity_id;
  select * into settings from core.scheduling_settings where brand_id = conversation.brand_id;

  select m.* into gap
  from core.messages m
  join core.conversations c on c.id = m.conversation_id
  where c.identity_id = identity.id and m.direction = 'in'
    and exists (
      select 1 from core.messages previous
      join core.conversations pc on pc.id = previous.conversation_id
      where pc.identity_id = identity.id and previous.direction = 'in' and previous.id < m.id
    )
    and m.sent_at - (
      select max(previous.sent_at) from core.messages previous
      join core.conversations pc on pc.id = previous.conversation_id
      where pc.identity_id = identity.id and previous.direction = 'in' and previous.id < m.id
    ) > make_interval(days => settings.reverify_after_days)
  order by m.id desc
  limit 1;

  if gap.id is null or (identity.last_verified_at is not null and identity.last_verified_at >= gap.sent_at) then
    return null;
  end if;
  return gap;
end;
$$;

-- `confirmar_titular`. The bot may only call it while the question is pending, so it cannot be used
-- to wipe a customer's context at will.
create function api.confirm_holder(p_conversation_id bigint, p_same_person boolean, p_new_name text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  conversation core.conversations;
  identity core.contact_identities;
  channel core.channels;
  brand core.brands;
  gap core.messages;
  v_new_contact_id bigint;
  v_new_conversation_id bigint;
  v_phone text;
begin
  select * into conversation from core.conversations where id = p_conversation_id for update;
  gap := core.reverify_gap_message(p_conversation_id);
  if gap.id is null then
    raise exception 'there is nothing to verify for this number' using errcode = 'CX002';
  end if;
  select * into identity from core.contact_identities where id = conversation.identity_id for update;

  if p_same_person then
    update core.contact_identities set last_verified_at = greatest(now(), gap.sent_at) where id = identity.id;
    return jsonb_build_object('misma_persona', true);
  end if;

  select * into channel from core.channels where id = conversation.channel_id;
  select * into brand from core.brands where id = conversation.brand_id;
  v_phone := case when identity.type = 'phone_e164' then identity.value end;

  -- The previous owner keeps everything: contact, history, opportunities, appointments.
  update core.identity_holders
  set valid_to = greatest(now(), valid_from + interval '1 microsecond'), closed_reason = 'reassigned_confirmed'
  where identity_id = identity.id and valid_to is null;

  insert into public.contacts (first_name, last_name, brand_id, is_test, phone_jsonb, first_seen, last_seen, sales_id)
  values (
    coalesce(nullif(left(trim(p_new_name), 80), ''), 'WhatsApp'),
    '••' || right(regexp_replace(identity.value, '\D', '', 'g'), 4),
    brand.id, channel.is_test,
    case when v_phone is null then null else jsonb_build_array(jsonb_build_object('number', v_phone, 'type', 'Mobile')) end,
    gap.sent_at, gap.sent_at, brand.default_sales_id
  )
  returning id into v_new_contact_id;
  insert into core.identity_holders (identity_id, contact_id) values (identity.id, v_new_contact_id);

  insert into public.deals (name, stage, contact_ids, primary_contact_id, brand_id, is_test, sales_id, index)
  values ('Nueva consulta', 'opportunity', array[v_new_contact_id], v_new_contact_id, brand.id, channel.is_test, brand.default_sales_id, 0);

  -- Only one open conversation per number: close the old one first.
  update core.conversations set closed_at = now(), closed_reason = 'holder_changed' where id = conversation.id;
  insert into core.conversations (brand_id, channel_id, identity_id, contact_id)
  values (brand.id, channel.id, identity.id, v_new_contact_id)
  returning id into v_new_conversation_id;
  update core.conversations set superseded_by = v_new_conversation_id where id = conversation.id;

  -- What was said since the silence, including the answers, was said by the new person.
  update core.messages set conversation_id = v_new_conversation_id where conversation_id = conversation.id and id >= gap.id;

  update core.contact_identities set last_verified_at = greatest(now(), gap.sent_at) where id = identity.id;
  return jsonb_build_object('misma_persona', false, 'nueva_conversacion', true);
end;
$$;

-- "Prueba X": a contact whose first name starts with "Prueba" is a test lead. The mark spreads to its
-- opportunities and appointments, so its slots stop blocking the real calendar. It is a trigger and not
-- core-api code so that it also holds for the panel and for imports. It is never undone by itself.
create function core.mark_test_contact() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if new.first_name ~* '^\s*prueba' then
    new.is_test := true;
  end if;
  return new;
end;
$$;
create trigger mark_test_contact before insert or update of first_name on public.contacts
  for each row execute function core.mark_test_contact();

create function core.spread_test_contact() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if new.is_test and (tg_op = 'INSERT' or not old.is_test) then
    update public.deals set is_test = true where primary_contact_id = new.id and not is_test;
    update core.appointments set is_test = true where contact_id = new.id and not is_test and status in ('hold', 'confirmed');
  end if;
  return null;
end;
$$;
-- Not "update of is_test": the flag is set by the BEFORE trigger above, and that does not count as a column of the statement.
create trigger spread_test_contact after insert or update on public.contacts
  for each row execute function core.spread_test_contact();

-- An opportunity of a test contact is a test, whoever creates it.
create function core.deal_follows_contact() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if not new.is_test and new.primary_contact_id is not null
     and exists (select 1 from public.contacts c where c.id = new.primary_contact_id and c.is_test) then
    new.is_test := true;
  end if;
  return new;
end;
$$;
create trigger deal_follows_contact before insert on public.deals
  for each row execute function core.deal_follows_contact();

-- A brand needs its document series from the start, with its own series for test leads.
create function core.brand_document_counters() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  insert into core.document_counters (brand_id, document_type, is_test, prefix) values
    (new.id, 'quote', false, 'COT'),
    (new.id, 'purchase_order', false, 'OC'),
    (new.id, 'work_order', false, 'OT'),
    (new.id, 'quote', true, 'PRUEBA-COT'),
    (new.id, 'purchase_order', true, 'PRUEBA-OC'),
    (new.id, 'work_order', true, 'PRUEBA-OT');
  return null;
end;
$$;
create trigger brand_document_counters after insert on core.brands
  for each row execute function core.brand_document_counters();
