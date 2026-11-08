-- Runtime controls per brand. Defaults preserve existing installations and presentation seeds.
alter table core.brands
  add column bot_enabled boolean not null default true,
  add column bot_agenda_enabled boolean not null default true,
  add column bot_generation integer not null default 0;

-- Old rows carry no sender metadata. Treat their unsent deliveries as bot work for the stop switch.
alter table core.outbox
  add column sender text not null default 'bot' check (sender in ('bot', 'human'));

create index messages_pending_dispatch_by_brand on core.messages (brand_id)
  where direction = 'in' and bot_dispatched_at is null;

create index outbox_undelivered_bot_by_brand on core.outbox (brand_id)
  where sender = 'bot' and status in ('pending', 'sending');

-- The brand update and the discarded work become visible together. Incrementing the generation
-- also prevents a previously issued token from working after the brand is enabled again.
create function core.stop_brand_bot() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  new.bot_generation := old.bot_generation + 1;
  update core.messages
    set bot_dispatched_at = now()
    where brand_id = new.id and direction = 'in' and bot_dispatched_at is null;
  update core.outbox
    set status = 'failed', last_error = 'bot_disabled'
    where brand_id = new.id and sender = 'bot' and status in ('pending', 'sending');
  return new;
end;
$$;

create trigger stop_brand_bot before update of bot_enabled on core.brands
  for each row when (old.bot_enabled and not new.bot_enabled)
  execute function core.stop_brand_bot();

-- Serialize inserting inbound messages and enqueueing bot replies with switching the brand off.
-- As with a paused conversation, inbound messages stay in the CRM but are terminal for dispatch.
create function core.apply_message_bot_control() returns trigger
  language plpgsql
  set search_path = ''
  as $$
declare
  enabled boolean;
begin
  select b.bot_enabled into enabled from core.brands b where b.id = new.brand_id for share;
  if not enabled then
    if new.direction = 'in' then
      new.bot_dispatched_at := coalesce(new.bot_dispatched_at, now());
    else
      raise exception 'bot disabled for brand' using errcode = 'CX007';
    end if;
  end if;
  return new;
end;
$$;

create trigger message_bot_control before insert on core.messages
  for each row when (new.direction = 'in' or new.sender = 'bot')
  execute function core.apply_message_bot_control();

create function api.bot_dispatch_generation(p_message_id bigint) returns integer
  language sql stable
  security definer
  set search_path = ''
  as $$
    select b.bot_generation
    from core.messages m
    join core.brands b on b.id = m.brand_id
    where m.id = p_message_id and m.direction = 'in' and m.bot_dispatched_at is null and b.bot_enabled
  $$;

create or replace function api.pending_dispatches(p_older_than_seconds integer, p_limit integer)
  returns table (message_id bigint)
  language sql stable
  security definer
  set search_path = ''
  as $$
    select m.id
    from core.messages m
    join core.conversations c on c.id = m.conversation_id
    join core.brands b on b.id = m.brand_id
    where m.direction = 'in'
      and m.bot_dispatched_at is null
      and not c.bot_paused
      and b.bot_enabled
      and m.created_at < now() - make_interval(secs => p_older_than_seconds)
      and m.created_at > now() - interval '1 day'
    order by m.id
    limit p_limit
  $$;

create or replace function api.tool_conversation(p_conversation_id bigint, p_brand_id bigint) returns jsonb
  language plpgsql stable
  security definer
  set search_path = ''
  as $$
declare
  conversation core.conversations;
  brand core.brands;
  hops integer := 0;
begin
  select * into conversation from core.conversations where id = p_conversation_id;
  if not found or conversation.brand_id <> p_brand_id then
    return null;
  end if;
  while conversation.superseded_by is not null and hops < 5 loop
    select * into conversation from core.conversations where id = conversation.superseded_by;
    hops := hops + 1;
  end loop;
  select * into brand from core.brands where id = p_brand_id;
  return jsonb_build_object(
    'conversation_id', conversation.id,
    'bot_paused', conversation.bot_paused,
    'closed', conversation.closed_at is not null,
    'bot_enabled', brand.bot_enabled,
    'bot_agenda_enabled', brand.bot_agenda_enabled,
    'bot_generation', brand.bot_generation
  );
end;
$$;

-- A worker may have claimed a batch before the switch. Check the row and the current brand
-- immediately before each HTTP request, after any pacing wait and file read.
create function api.outbox_sendable(p_id bigint, p_attempt integer) returns boolean
  language sql stable
  security definer
  set search_path = ''
  as $$
    select exists (
      select 1 from core.outbox o
      join core.brands b on b.id = o.brand_id
      where o.id = p_id and o.status = 'sending' and o.attempts = p_attempt
        and (o.sender = 'human' or b.bot_enabled)
    )
  $$;

-- Preserve the actor in the outbox so an operator can still send while the bot is off.
create or replace function api.enqueue_outbound(
  p_conversation_id bigint,
  p_body text,
  p_sender text default 'bot',
  p_send_body text default null
) returns bigint
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

  insert into core.outbox (brand_id, channel_id, conversation_id, destination, body, sender)
  values (
    conversation.brand_id, conversation.channel_id, conversation.id,
    case identity.type when 'phone_e164' then substr(identity.value, 2) || '@c.us' else identity.value end,
    coalesce(p_send_body, p_body), p_sender
  )
  returning id into v_outbox_id;
  return v_outbox_id;
end;
$$;

create or replace function api.enqueue_document(p_document_id bigint, p_file_id bigint, p_caption text, p_sender text default 'human') returns bigint
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_document core.documents;
  v_contact_id bigint;
  v_conversation core.conversations;
  v_identity core.contact_identities;
  v_outbox_id bigint;
begin
  if p_sender not in ('bot', 'human') then
    raise exception 'invalid sender' using errcode = 'CX004';
  end if;
  select * into v_document from core.documents where id = p_document_id;
  if not found or not exists (select 1 from core.document_files where id = p_file_id and document_id = p_document_id) then
    raise exception 'unknown document file' using errcode = 'CX004', hint = 'unknown_document';
  end if;
  if v_document.status <> 'issued' then
    raise exception 'a voided document is not sent' using errcode = 'CX002', hint = 'voided';
  end if;

  select coalesce(
    (select a.contact_id from core.appointments a where a.id = v_document.appointment_id),
    (select coalesce(d.primary_contact_id, d.contact_ids[1]) from public.deals d where d.id = v_document.deal_id)
  ) into v_contact_id;

  select * into v_conversation
  from core.conversations
  where contact_id = v_contact_id and brand_id = v_document.brand_id and closed_at is null and superseded_by is null
  order by opened_at desc limit 1;
  if not found then
    raise exception 'the customer has no open conversation' using errcode = 'CX002', hint = 'no_conversation';
  end if;
  select * into v_identity from core.contact_identities where id = v_conversation.identity_id;

  insert into core.messages (brand_id, conversation_id, channel_id, direction, sender, body, sent_at)
  values (v_conversation.brand_id, v_conversation.id, v_conversation.channel_id, 'out', p_sender, p_caption, now());

  insert into core.outbox (brand_id, channel_id, conversation_id, destination, body, document_file_id, sender)
  values (
    v_conversation.brand_id, v_conversation.channel_id, v_conversation.id,
    case v_identity.type when 'phone_e164' then substr(v_identity.value, 2) || '@c.us' else v_identity.value end,
    p_caption, p_file_id, p_sender
  )
  returning id into v_outbox_id;
  return v_outbox_id;
end;
$$;
