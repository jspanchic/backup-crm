-- Inbound messages, bot dispatch and outbox. Every function is security definer and is the only
-- way core-api touches these tables. Callers never pass a contact id: it comes from the conversation.

-- Channel lookup before the signature check: core-api needs the secret name to verify the HMAC.
create function api.resolve_channel(p_provider text, p_identifier text) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object('channel_id', id, 'secret_ref', secret_ref, 'bot_key', bot_key, 'is_test', is_test)
    from core.channels
    where provider = p_provider and identifier = p_identifier and active
  $$;

-- An unknown channel is recorded without body or phone, at most once a minute per identifier,
-- so nobody can grow the table by repeating requests.
create function api.record_unrouted(p_provider text, p_identifier text) returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  perform pg_advisory_xact_lock(hashtext('unrouted:' || p_provider || ':' || p_identifier));
  if not exists (
    select 1 from core.unrouted_events
    where provider = p_provider and identifier = p_identifier and received_at > now() - interval '1 minute'
  ) then
    insert into core.unrouted_events (provider, identifier) values (p_provider, left(p_identifier, 200));
  end if;
end;
$$;

create function api.ingest_inbound(
  p_provider text,
  p_identifier text,
  p_provider_message_id text,
  p_sent_at timestamptz,
  p_body text,
  p_phone_e164 text,
  p_lid text,
  p_push_name text
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  channel core.channels;
  brand core.brands;
  identity core.contact_identities;
  holder core.identity_holders;
  conversation core.conversations;
  v_contact_id bigint;
  v_message_id bigint;
  v_new_contact boolean := false;
  v_identity_type text;
  v_identity_value text;
  v_last_digits text;
begin
  select * into channel from core.channels where provider = p_provider and identifier = p_identifier and active;
  if not found then
    raise exception 'unknown channel' using errcode = 'CX004';
  end if;
  select * into brand from core.brands where id = channel.brand_id;

  -- Serializes two deliveries of the same message, so the duplicate check below is reliable.
  perform pg_advisory_xact_lock(hashtext('msg:' || channel.id || ':' || p_provider_message_id));
  if exists (
    select 1 from core.messages where channel_id = channel.id and provider_message_id = p_provider_message_id
  ) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  if p_phone_e164 is not null then
    v_identity_type := 'phone_e164';
    v_identity_value := p_phone_e164;
  elsif p_lid is not null then
    v_identity_type := 'wa_lid';
    v_identity_value := p_lid;
  else
    raise exception 'a message needs a phone or a lid' using errcode = 'CX004';
  end if;

  perform pg_advisory_xact_lock(hashtext('identity:' || brand.id || ':' || v_identity_type || ':' || v_identity_value));
  select * into identity from core.contact_identities
    where brand_id = brand.id and type = v_identity_type and value = v_identity_value;
  if not found then
    insert into core.contact_identities (brand_id, type, value)
    values (brand.id, v_identity_type, v_identity_value)
    returning * into identity;
  end if;

  select * into holder from core.identity_holders where identity_id = identity.id and valid_to is null;
  if found then
    v_contact_id := holder.contact_id;
  else
    v_last_digits := right(regexp_replace(v_identity_value, '\D', '', 'g'), 4);
    insert into public.contacts (first_name, last_name, brand_id, is_test, phone_jsonb, first_seen, last_seen, sales_id)
    values (
      coalesce(nullif(left(trim(p_push_name), 80), ''), 'WhatsApp'),
      '••' || v_last_digits,
      brand.id,
      channel.is_test,
      case when p_phone_e164 is null then null
           else jsonb_build_array(jsonb_build_object('number', p_phone_e164, 'type', 'Mobile')) end,
      p_sent_at, p_sent_at, brand.default_sales_id
    )
    returning id into v_contact_id;
    insert into core.identity_holders (identity_id, contact_id) values (identity.id, v_contact_id);
    v_new_contact := true;
  end if;

  update public.contacts set last_seen = greatest(coalesce(last_seen, p_sent_at), p_sent_at) where id = v_contact_id;

  -- An opportunity opens by itself with the first message, and again when the previous one is closed.
  if not exists (
    select 1 from public.deals
    where primary_contact_id = v_contact_id and stage not in ('won', 'lost') and archived_at is null
  ) then
    insert into public.deals (name, stage, contact_ids, primary_contact_id, brand_id, is_test, sales_id, index)
    values ('Nueva consulta', 'opportunity', array[v_contact_id], v_contact_id, brand.id, channel.is_test, brand.default_sales_id, 0);
  end if;

  select * into conversation from core.conversations
    where channel_id = channel.id and identity_id = identity.id and closed_at is null;
  if not found then
    insert into core.conversations (brand_id, channel_id, identity_id, contact_id)
    values (brand.id, channel.id, identity.id, v_contact_id)
    returning * into conversation;
  end if;

  insert into core.messages (
    brand_id, conversation_id, channel_id, direction, sender, body, provider_message_id, sent_at, bot_dispatched_at
  )
  values (
    brand.id, conversation.id, channel.id, 'in', 'client', p_body, p_provider_message_id, p_sent_at,
    case when conversation.bot_paused then now() end -- paused: a person answers, the bot must not
  )
  returning id into v_message_id;

  update core.contact_identities set last_inbound_at = p_sent_at where id = identity.id;

  return jsonb_build_object(
    'status', 'accepted',
    'conversation_id', conversation.id,
    'message_id', v_message_id,
    'bot_key', channel.bot_key,
    'bot_paused', conversation.bot_paused,
    'new_contact', v_new_contact
  );
end;
$$;

-- Everything the bot may know, built from a message id. Never includes the full phone number.
create function api.bot_context(p_message_id bigint) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
declare
  msg core.messages;
  conversation core.conversations;
  channel core.channels;
  brand core.brands;
  contact public.contacts;
  identity core.contact_identities;
  settings core.scheduling_settings;
  deal public.deals;
  previous_inbound timestamptz;
  v_reverify boolean;
  v_phone_mask text;
  v_quote jsonb;
  v_appointment jsonb;
  v_history jsonb;
begin
  select * into msg from core.messages where id = p_message_id and direction = 'in';
  if not found then
    raise exception 'unknown inbound message' using errcode = 'CX004';
  end if;
  select * into conversation from core.conversations where id = msg.conversation_id;
  select * into channel from core.channels where id = conversation.channel_id;
  select * into brand from core.brands where id = conversation.brand_id;
  select * into contact from public.contacts where id = conversation.contact_id;
  select * into identity from core.contact_identities where id = conversation.identity_id;
  select * into settings from core.scheduling_settings where brand_id = brand.id;

  select max(m.sent_at) into previous_inbound
  from core.messages m
  join core.conversations c on c.id = m.conversation_id
  where c.identity_id = identity.id and m.direction = 'in' and m.id < msg.id;
  -- After a long silence the bot confirms the name before using old data: the number may have changed owner.
  v_reverify := previous_inbound is not null
    and settings.reverify_after_days is not null
    and previous_inbound < msg.sent_at - make_interval(days => settings.reverify_after_days)
    and (identity.last_verified_at is null or identity.last_verified_at < msg.sent_at - make_interval(days => settings.reverify_after_days));

  v_phone_mask := case
    when identity.type = 'phone_e164'
      then left(identity.value, 2) || repeat('•', greatest(length(identity.value) - 6, 1)) || right(identity.value, 4)
  end;

  select * into deal from public.deals
    where primary_contact_id = contact.id and stage not in ('won', 'lost') and archived_at is null
    order by id desc limit 1;

  select jsonb_build_object('version', q.version, 'total', q.total, 'currency', q.currency, 'price_confirmed', q.price_confirmed)
    into v_quote
    from core.quotes q where q.deal_id = deal.id and q.status = 'sent' order by q.version desc limit 1;

  select jsonb_build_object('start_at', a.start_at, 'end_at', a.end_at, 'status', a.status, 'address', a.address)
    into v_appointment
    from core.appointments a
    where a.deal_id = deal.id and a.status in ('hold', 'confirmed') order by a.start_at limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('de', h.who, 'texto', h.body) order by h.id), '[]'::jsonb)
    into v_history
    from (
      select m.id, m.sent_at, m.body,
             case m.sender when 'client' then 'cliente' when 'bot' then 'bot' else 'humano' end as who
      from core.messages m
      where m.conversation_id = conversation.id and m.id <> msg.id
      order by m.id desc
      limit 40
    ) h;

  return jsonb_build_object(
    'message_id', msg.id,
    'conversation_id', conversation.id,
    'brand_id', brand.id,
    'bot_paused', conversation.bot_paused,
    'tenant', brand.slug,
    'bot', channel.bot_key,
    'canal', 'whatsapp',
    -- Not the provider id: WAHA builds it from the customer's phone number.
    'mensaje', jsonb_build_object('id', 'msg_' || msg.id, 'texto', msg.body),
    'contacto', jsonb_build_object(
      'nombre', case when contact.first_name = 'WhatsApp' then null else contact.first_name end,
      'nuevo', not exists (select 1 from core.messages m where m.conversation_id = conversation.id and m.id < msg.id),
      'reverificar', v_reverify,
      'telefono_enmascarado', v_phone_mask,
      'idioma', contact.preferred_language
    ),
    'historial', v_history,
    'ficha', jsonb_build_object(
      'etapa', deal.stage,
      'zip', deal.zip,
      'cotizacion_vigente', v_quote,
      'cita', v_appointment
    )
  );
end;
$$;

create function api.pending_dispatches(p_older_than_seconds integer, p_limit integer) returns table (message_id bigint)
  language sql stable
  security definer
  set search_path = ''
  as $$
    select m.id
    from core.messages m
    join core.conversations c on c.id = m.conversation_id
    where m.direction = 'in'
      and m.bot_dispatched_at is null
      and not c.bot_paused
      and m.created_at < now() - make_interval(secs => p_older_than_seconds)
      and m.created_at > now() - interval '1 day'
    order by m.id
    limit p_limit
  $$;

create function api.mark_dispatched(p_message_id bigint) returns void
  language sql
  security definer
  set search_path = ''
  as $$ update core.messages set bot_dispatched_at = now() where id = p_message_id and bot_dispatched_at is null $$;

-- Queues a reply for sending and records it in the conversation history.
create function api.enqueue_outbound(p_conversation_id bigint, p_body text, p_sender text default 'bot') returns bigint
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  conversation core.conversations;
  identity core.contact_identities;
  v_outbox_id bigint;
begin
  if p_sender not in ('bot', 'human') then
    raise exception 'invalid sender' using errcode = 'CX004';
  end if;
  select * into conversation from core.conversations where id = p_conversation_id;
  if not found then
    raise exception 'unknown conversation' using errcode = 'CX004';
  end if;
  select * into identity from core.contact_identities where id = conversation.identity_id;

  insert into core.messages (brand_id, conversation_id, channel_id, direction, sender, body, sent_at)
  values (conversation.brand_id, conversation.id, conversation.channel_id, 'out', p_sender, p_body, now());

  insert into core.outbox (brand_id, channel_id, conversation_id, destination, body)
  values (
    conversation.brand_id, conversation.channel_id, conversation.id,
    case identity.type when 'phone_e164' then substr(identity.value, 2) || '@c.us' else identity.value end,
    p_body
  )
  returning id into v_outbox_id;
  return v_outbox_id;
end;
$$;

-- Takes due rows for one worker. A row stuck in 'sending' for two minutes is taken again.
create function api.claim_outbox(p_limit integer)
  returns table (id bigint, session text, destination text, body text, attempts integer)
  language sql
  security definer
  set search_path = ''
  as $$
    with due as (
      select o.id
      from core.outbox o
      where (o.status = 'pending' and o.scheduled_at <= now())
         or (o.status = 'sending' and o.scheduled_at < now() - interval '2 minutes')
      order by o.scheduled_at, o.id
      limit p_limit
      for update skip locked
    )
    update core.outbox o
    set status = 'sending', attempts = o.attempts + 1, scheduled_at = now()
    from due, core.channels c
    where o.id = due.id and c.id = o.channel_id
    returning o.id, c.identifier, o.destination, o.body, o.attempts
  $$;

-- Three attempts with a growing wait, then 'failed' for a person to see.
create function api.finish_outbox(p_id bigint, p_ok boolean, p_error text) returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  row_ core.outbox;
begin
  select * into row_ from core.outbox where id = p_id for update;
  if not found or row_.status <> 'sending' then
    return;
  end if;
  if p_ok then
    update core.outbox set status = 'sent', sent_at = now(), last_error = null where id = p_id;
  elsif row_.attempts >= 3 then
    update core.outbox set status = 'failed', last_error = left(p_error, 500) where id = p_id;
  else
    update core.outbox
    set status = 'pending', last_error = left(p_error, 500),
        scheduled_at = now() + make_interval(secs => 30 * row_.attempts * row_.attempts)
    where id = p_id;
  end if;
end;
$$;
