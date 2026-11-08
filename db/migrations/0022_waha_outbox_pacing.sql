-- The WAHA session owns its delays. The rate is shared across all active sessions.
alter table core.channels
  add column waha_before_seen_ms integer not null default 2000 check (waha_before_seen_ms between 0 and 15000),
  add column waha_before_typing_ms integer not null default 2000 check (waha_before_typing_ms between 0 and 15000),
  add column waha_before_send_ms integer not null default 2000 check (waha_before_send_ms between 0 and 15000),
  add column waha_messages_per_minute integer not null default 6 check (waha_messages_per_minute between 1 and 60);

alter table core.brands add column pdf_clientes_reales boolean not null default false;

alter table core.messages
  add column waha_chat_id text check (waha_chat_id ~ '^[0-9]{1,200}@(c[.]us|lid)$'),
  add column bot_dispatch_claim uuid,
  add column bot_dispatch_lease_until timestamptz;

alter table core.outbox
  add column claim_expires_at timestamptz,
  add column send_started_at timestamptz,
  add column delivery_retries integer not null default 0 check (delivery_retries between 0 and 3);

-- Reservations survive worker restarts and count even if WAHA rejects the request or its result is lost.
create table core.outbox_send_attempts (
  outbox_id bigint not null references core.outbox (id) on delete cascade,
  attempt integer not null,
  started_at timestamptz not null,
  primary key (outbox_id, attempt)
);
create index outbox_send_attempts_started_idx on core.outbox_send_attempts (started_at);
create index outbox_claim_expiry_idx on core.outbox (claim_expires_at) where claim_expires_at is not null;
create index outbox_chat_head_idx on core.outbox (channel_id, destination, id)
  where status in ('pending', 'sending') or (status = 'failed' and starts_with(last_error, 'delivery_uncertain'));
create index outbox_conversation_head_idx on core.outbox (channel_id, conversation_id, id)
  where status in ('pending', 'sending') or (status = 'failed' and starts_with(last_error, 'delivery_uncertain'));
create index messages_latest_inbound_idx on core.messages (conversation_id, sent_at desc, id desc)
  where direction = 'in' and waha_chat_id is not null;

create or replace function core.stop_brand_bot() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  new.bot_generation := old.bot_generation + 1;
  update core.messages
    set bot_dispatched_at = now()
    where brand_id = new.id and direction = 'in' and bot_dispatched_at is null;
  -- Let a fenced POST finish and record what happened. The error marker also suppresses a
  -- retry of this job even if the operator switches the bot back on before WAHA replies.
  update core.outbox
    set status = case when status = 'sending' and send_started_at is not null then 'sending' else 'failed' end,
        last_error = 'bot_disabled'
    where brand_id = new.id and sender = 'bot' and status in ('pending', 'sending');
  return new;
end;
$$;

-- Preserve the original eight-argument ingress function. A duplicate never changes the chat id.
create function api.ingest_inbound(
  p_provider text, p_identifier text, p_provider_message_id text, p_sent_at timestamptz,
  p_body text, p_phone_e164 text, p_lid text, p_push_name text, p_waha_chat_id text
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_result jsonb;
begin
  v_result := api.ingest_inbound(p_provider, p_identifier, p_provider_message_id, p_sent_at,
                                 p_body, p_phone_e164, p_lid, p_push_name);
  if v_result ->> 'status' = 'accepted' then
    update core.messages set waha_chat_id = p_waha_chat_id where id = (v_result ->> 'message_id')::bigint;
  end if;
  return v_result;
end;
$$;

-- These transport details are private to core-api and excluded from the bot webhook context.
create function api.bot_dispatch_waha(p_message_id bigint) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object(
      'session', c.identifier,
      'chatId', coalesce(m.waha_chat_id, case i.type when 'phone_e164' then substr(i.value, 2) || '@c.us' else i.value end),
      'providerMessageId', m.provider_message_id,
      'beforeSeenMs', c.waha_before_seen_ms,
      'beforeTypingMs', c.waha_before_typing_ms
    )
    from core.messages m
    join core.channels c on c.id = m.channel_id
    join core.conversations v on v.id = m.conversation_id
    join core.contact_identities i on i.id = v.identity_id
    where m.id = p_message_id and m.direction = 'in' and c.provider = 'waha' and c.active
  $$;

-- One process may attempt the presence calls and n8n webhook for this inbound message at a time.
create function api.claim_bot_dispatch(p_message_id bigint) returns uuid
  language sql
  security definer
  set search_path = ''
  as $$
    update core.messages m
      set bot_dispatch_claim = gen_random_uuid(), bot_dispatch_lease_until = clock_timestamp() + interval '2 minutes'
    from core.brands b, core.channels c, core.conversations v
    where m.id = p_message_id and m.direction = 'in' and m.bot_dispatched_at is null
      and (m.bot_dispatch_lease_until is null or m.bot_dispatch_lease_until <= clock_timestamp())
      and b.id = m.brand_id and b.bot_enabled and c.id = m.channel_id and c.active
      and v.id = m.conversation_id and not v.bot_paused and v.closed_at is null
    returning m.bot_dispatch_claim
  $$;

create function api.bot_dispatch_generation(p_message_id bigint, p_claim uuid) returns integer
  language sql stable
  security definer
  set search_path = ''
  as $$
    select b.bot_generation
    from core.messages m
    join core.brands b on b.id = m.brand_id
    join core.channels c on c.id = m.channel_id
    join core.conversations v on v.id = m.conversation_id
    where m.id = p_message_id and m.direction = 'in' and m.bot_dispatched_at is null
      and m.bot_dispatch_claim = p_claim and m.bot_dispatch_lease_until > now()
      and b.bot_enabled and c.active and not v.bot_paused and v.closed_at is null
  $$;

create function api.finish_bot_dispatch(p_message_id bigint, p_claim uuid, p_dispatched boolean) returns void
  language sql
  security definer
  set search_path = ''
  as $$
    update core.messages m
    set bot_dispatched_at = case when p_dispatched then coalesce(m.bot_dispatched_at, clock_timestamp()) else m.bot_dispatched_at end,
        bot_dispatch_claim = null, bot_dispatch_lease_until = null
    where m.id = p_message_id and m.bot_dispatch_claim = p_claim
  $$;

create or replace function api.pending_dispatches(p_older_than_seconds integer, p_limit integer)
  returns table (message_id bigint)
  language sql stable
  security definer
  set search_path = ''
  as $$
    select m.id
    from core.messages m
    join core.conversations v on v.id = m.conversation_id
    join core.brands b on b.id = m.brand_id
    join core.channels c on c.id = m.channel_id
    where m.direction = 'in' and m.bot_dispatched_at is null
      and (m.bot_dispatch_lease_until is null or m.bot_dispatch_lease_until <= now())
      and not v.bot_paused and v.closed_at is null and b.bot_enabled and c.active
      and m.created_at < now() - make_interval(secs => p_older_than_seconds)
      and m.created_at > now() - interval '1 day'
    order by m.id
    limit p_limit
  $$;

create function core.outbox_chat_id(
  p_brand_id bigint, p_channel_id bigint, p_conversation_id bigint, p_inbound_id bigint default null
) returns text
  language sql stable
  set search_path = ''
  as $$
    select coalesce(
      (select m.waha_chat_id from core.messages m
       where m.id = p_inbound_id and m.brand_id = p_brand_id and m.channel_id = p_channel_id
         and m.conversation_id = p_conversation_id and m.direction = 'in'),
      (select m.waha_chat_id from core.messages m
       where m.conversation_id = p_conversation_id and m.brand_id = p_brand_id and m.channel_id = p_channel_id
         and m.direction = 'in' and m.waha_chat_id is not null
       order by m.sent_at desc, m.id desc limit 1)
    )
  $$;

-- Old workers did not record whether WAHA received a request. A legacy retry might already
-- have reached the chat, so keep it for manual review just like an in-flight job.
update core.outbox set status = 'failed', last_error = 'delivery_uncertain: legacy send was attempted'
  where status = 'sending' or (status = 'pending' and attempts > 0);
-- Preserve the rate window across an upgrade. Legacy completion times are conservative send-start estimates.
insert into core.outbox_send_attempts (outbox_id, attempt, started_at)
select id, greatest(attempts, 1), sent_at from core.outbox
where status = 'sent' and sent_at > now() - interval '1 minute';

-- Documents have no exact triggering message. Prefer the latest saved address for the chat.
create function core.snapshot_document_destination() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  new.destination := coalesce(core.outbox_chat_id(new.brand_id, new.channel_id, new.conversation_id), new.destination);
  return new;
end;
$$;
create trigger snapshot_document_destination before insert on core.outbox
  for each row when (new.document_file_id is not null and new.conversation_id is not null)
  execute function core.snapshot_document_destination();

create function api.enqueue_outbound(
  p_conversation_id bigint, p_body text, p_sender text, p_send_body text, p_inbound_message_id bigint
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
    coalesce(core.outbox_chat_id(conversation.brand_id, conversation.channel_id, conversation.id, p_inbound_message_id),
             case identity.type when 'phone_e164' then substr(identity.value, 2) || '@c.us' else identity.value end),
    coalesce(p_send_body, p_body), p_sender
  ) returning id into v_outbox_id;
  return v_outbox_id;
end;
$$;

create or replace function api.enqueue_outbound(
  p_conversation_id bigint, p_body text, p_sender text default 'bot', p_send_body text default null
) returns bigint
  language sql
  security definer
  set search_path = ''
  as $$
    select api.enqueue_outbound(p_conversation_id, p_body, p_sender, p_send_body, null::bigint)
  $$;

create function core.outbox_pdf_allowed(p_file_id bigint, p_real_enabled boolean) returns boolean
  language sql stable
  set search_path = ''
  as $$
    select p_file_id is null or p_real_enabled or exists (
      select 1 from core.document_files f join core.documents d on d.id = f.document_id
      where f.id = p_file_id and d.is_test
    )
  $$;

-- All active WAHA channels share a rolling budget and a minimum interval between POSTs.
-- Call only while holding the outbox advisory transaction lock.
create function core.outbox_next_send_at(p_now timestamptz) returns timestamptz
  language sql stable
  set search_path = ''
  as $$
    with rate as (
      select coalesce(min(c.waha_messages_per_minute), 6) as cap
      from core.channels c where c.provider = 'waha' and c.active
    ), recent as (
      select a.started_at
      from core.outbox_send_attempts a
      where a.started_at > p_now - interval '1 minute'
      order by a.started_at desc
      limit (select cap from rate)
    )
    select greatest(
      p_now,
      max(recent.started_at) + make_interval(secs => 60.0 / rate.cap),
      case when count(recent.started_at) = rate.cap then min(recent.started_at) + interval '1 minute' end
    )
    from rate left join recent on true
    group by rate.cap
  $$;

drop function api.claim_outbox(integer);
create function api.claim_outbox(p_limit integer)
  returns table (id bigint, session text, destination text, body text, attempts integer,
                 document_file_id bigint, file_sha256 text, file_name text, waha_before_send_ms integer)
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_now timestamptz;
begin
  if p_limit is null or p_limit < 1 then
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('salvionix_outbox_pacing'));
  v_now := clock_timestamp();

  -- A worker that died before the send fence can be retried. An unacknowledged POST
  -- requires manual review. Keep that chat's following messages behind it.
  update core.outbox o
  set claim_expires_at = null,
      status = case
        when o.send_started_at is not null or o.delivery_retries >= 2 then 'failed'
        else 'pending'
      end,
      delivery_retries = case when o.send_started_at is null then least(o.delivery_retries + 1, 3) else o.delivery_retries end,
      last_error = case when o.send_started_at is null then 'worker_claim_expired' else 'delivery_uncertain: worker claim expired' end,
      scheduled_at = v_now + make_interval(secs => 30 * (o.delivery_retries + 1) * (o.delivery_retries + 1))
  where o.status = 'sending' and o.claim_expires_at <= v_now;
  update core.outbox o set claim_expires_at = null
  where o.status <> 'sending' and o.claim_expires_at <= v_now;

  -- The lease also outlives a bot kill switch until the current worker has cleaned up typing.
  if exists (select 1 from core.outbox o where o.claim_expires_at > v_now)
     or core.outbox_next_send_at(v_now) > v_now then
    return;
  end if;

  return query
    with due as (
      select o.id
      from core.outbox o
      join core.brands b on b.id = o.brand_id
      join core.channels c on c.id = o.channel_id
      where o.status = 'pending' and o.scheduled_at <= v_now and c.active
        and (o.sender = 'human' or b.bot_enabled)
        and core.outbox_pdf_allowed(o.document_file_id, b.pdf_clientes_reales)
        and not exists (
          select 1 from core.outbox prior
          where prior.channel_id = o.channel_id and prior.id < o.id
            and (prior.destination = o.destination or prior.conversation_id = o.conversation_id)
            and (prior.status in ('pending', 'sending') or
                 (prior.status = 'failed' and starts_with(prior.last_error, 'delivery_uncertain')))
        )
      order by o.scheduled_at, o.id
      limit 1
      for update of o skip locked
    ), claimed as (
      update core.outbox o
      set status = 'sending', attempts = o.attempts + 1,
          claim_expires_at = v_now + interval '2 minutes', send_started_at = null
      from due where o.id = due.id
      returning o.*
    )
    select cl.id, c.identifier, cl.destination, cl.body, cl.attempts, cl.document_file_id, f.sha256,
           d.display_number || '.pdf', c.waha_before_send_ms
    from claimed cl
    join core.channels c on c.id = cl.channel_id
    left join core.document_files f on f.id = cl.document_file_id
    left join core.documents d on d.id = f.document_id;
end;
$$;

create or replace function api.outbox_sendable(p_id bigint, p_attempt integer) returns boolean
  language sql stable
  security definer
  set search_path = ''
  as $$
    select exists (
      select 1 from core.outbox o
      join core.brands b on b.id = o.brand_id
      join core.channels c on c.id = o.channel_id
      where o.id = p_id and o.status = 'sending' and o.attempts = p_attempt
        and o.claim_expires_at > now() and c.active and (o.sender = 'human' or b.bot_enabled)
        and core.outbox_pdf_allowed(o.document_file_id, b.pdf_clientes_reales)
    )
  $$;

create function api.begin_outbox_send(p_id bigint, p_attempt integer) returns text
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_now timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('salvionix_outbox_pacing'));
  v_now := clock_timestamp();
  if core.outbox_next_send_at(v_now) > v_now then
    return 'throttled';
  end if;

  -- Updating the queue row is also the fence against the concurrent bot kill switch.
  update core.outbox o set send_started_at = v_now
  from core.brands b, core.channels c
  where o.id = p_id and o.status = 'sending' and o.attempts = p_attempt and o.claim_expires_at > v_now
    and o.send_started_at is null and b.id = o.brand_id and c.id = o.channel_id and c.active
    and (o.sender = 'human' or b.bot_enabled)
    and core.outbox_pdf_allowed(o.document_file_id, b.pdf_clientes_reales);
  if not found then
    return 'stale';
  end if;

  insert into core.outbox_send_attempts (outbox_id, attempt, started_at) values (p_id, p_attempt, v_now);
  delete from core.outbox_send_attempts where started_at < v_now - interval '3 minutes';
  return 'send';
end;
$$;

drop function api.finish_outbox(bigint, boolean, text);
create function api.finish_paced_outbox(p_id bigint, p_attempt integer, p_outcome text, p_error text) returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_outbox core.outbox;
  v_now timestamptz;
  v_retries integer;
begin
  select * into v_outbox from core.outbox where id = p_id for update;
  if not found or v_outbox.attempts is distinct from p_attempt or v_outbox.claim_expires_at is null then
    return;
  end if;
  v_now := clock_timestamp();
  if v_outbox.claim_expires_at <= v_now then
    -- Recovery will fence the expired attempt and flag an unacknowledged POST.
    return;
  end if;
  if p_outcome is null or p_outcome not in ('sent', 'retry', 'uncertain', 'failed', 'throttled', 'stale') then
    raise exception 'invalid outbox outcome' using errcode = 'CX004';
  end if;

  -- The kill switch may have changed the status while presence or WAHA was in flight.
  -- If a POST was started, retain what the worker could prove about its result.
  if v_outbox.status <> 'sending' and v_outbox.send_started_at is null then
    update core.outbox set claim_expires_at = null where id = p_id;
    return;
  end if;
  if p_outcome = 'sent' and v_outbox.send_started_at is not null then
    update core.outbox set status = 'sent', sent_at = v_now, last_error = null, claim_expires_at = null where id = p_id;
  elsif p_outcome = 'uncertain' or (v_outbox.send_started_at is not null and p_outcome in ('throttled', 'stale')) then
    update core.outbox
      set status = 'failed', last_error = left(concat('delivery_uncertain: ', p_error), 500), claim_expires_at = null
    where id = p_id;
  elsif v_outbox.status <> 'sending' or v_outbox.last_error in ('bot_disabled', 'pdf_real_disabled') then
    update core.outbox set status = 'failed', claim_expires_at = null where id = p_id;
  elsif p_outcome = 'throttled' then
    update core.outbox set status = 'pending', scheduled_at = greatest(v_now + interval '1 second', core.outbox_next_send_at(v_now)),
                          claim_expires_at = null where id = p_id;
  else
    v_retries := least(v_outbox.delivery_retries + 1, 3);
    update core.outbox
      set status = case when p_outcome = 'retry' and v_retries < 3 then 'pending' else 'failed' end,
          scheduled_at = v_now + make_interval(secs => 30 * v_retries * v_retries),
          delivery_retries = v_retries, last_error = left(p_error, 500), claim_expires_at = null
    where id = p_id;
  end if;
end;
$$;
