-- Numbers belong to the brand, not a session. An empty list disables the team command.
create table core.team_reset_numbers (
  brand_id bigint not null references core.brands (id),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  primary key (brand_id, phone_e164)
);

-- The privileged reset sets this transaction-local scope while deleting one test contact.
-- Direct deletes and deletes of real CRM records keep their original guards.
create function core.team_reset_contact() returns bigint
  language sql stable
  set search_path = ''
  as $$
    select nullif(current_setting('core.team_reset_contact_id', true), '')::bigint
  $$;

create or replace function core.documents_guard() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if tg_op = 'DELETE' then
    if old.is_test and exists (
      select 1 from public.deals
      where id = old.deal_id and is_test and primary_contact_id = core.team_reset_contact()
    ) then
      return old;
    end if;
    raise exception 'documents cannot be deleted; void them' using errcode = 'CX001';
  end if;
  if (to_jsonb(new) - 'status' - 'voided_at' - 'void_reason')
     is distinct from (to_jsonb(old) - 'status' - 'voided_at' - 'void_reason') then
    raise exception 'documents are immutable' using errcode = 'CX001';
  end if;
  if old.status = 'voided' then
    raise exception 'a voided document cannot change' using errcode = 'CX001';
  end if;
  return new;
end;
$$;

create or replace function core.document_files_guard() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if tg_op = 'DELETE' and exists (
    select 1 from core.documents d
    join public.deals lead on lead.id = d.deal_id
    where d.id = old.document_id and d.is_test and lead.is_test
      and lead.primary_contact_id = core.team_reset_contact()
  ) then
    return old;
  end if;
  raise exception 'stored document files cannot be changed or deleted' using errcode = 'CX001';
end;
$$;

create or replace function core.quotes_guard() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if tg_op = 'DELETE' then
    if exists (
      select 1 from public.deals
      where id = old.deal_id and is_test and primary_contact_id = core.team_reset_contact()
    ) then
      return old;
    end if;
    raise exception 'quotes cannot be deleted' using errcode = 'CX001';
  end if;
  if (to_jsonb(new) - 'status' - 'valid_until') is distinct from (to_jsonb(old) - 'status' - 'valid_until') then
    raise exception 'quotes are immutable' using errcode = 'CX001';
  end if;
  return new;
end;
$$;

create or replace function core.appointments_no_delete() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if old.is_test and old.contact_id = core.team_reset_contact() then
    return old;
  end if;
  raise exception 'appointments cannot be deleted; cancel them' using errcode = 'CX001';
end;
$$;

create function api.try_team_reset(p_session text, p_provider_message_id text, p_phone_e164 text, p_chat_id text)
  returns text
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_channel core.channels;
  v_identity_id bigint;
  v_contact public.contacts;
  v_deals bigint[];
  v_conversations bigint[];
  v_files bigint[];
  v_protected boolean := false;
begin
  select * into v_channel from core.channels where provider = 'waha' and identifier = p_session and active;
  if not found or p_phone_e164 is null then
    return 'not_authorized';
  end if;
  perform 1 from core.team_reset_numbers
    where brand_id = v_channel.brand_id and phone_e164 = p_phone_e164 for key share;
  if not found then
    return 'not_authorized';
  end if;
  if p_provider_message_id is null or p_chat_id is null then
    raise exception 'reset requires a message ID and chat ID' using errcode = 'CX004';
  end if;

  perform pg_advisory_xact_lock(hashtext('msg:' || v_channel.id || ':' || p_provider_message_id));
  if exists (select 1 from core.messages where channel_id = v_channel.id and provider_message_id = p_provider_message_id)
    or exists (select 1 from core.team_reset_receipts where channel_id = v_channel.id and provider_message_hash = sha256(convert_to(p_provider_message_id, 'UTF8')))
    or exists (select 1 from core.waha_lid_escalations where channel_id = v_channel.id and provider_message_id = p_provider_message_id)
  then
    return 'duplicate';
  end if;

  perform pg_advisory_xact_lock(hashtext('identity:' || v_channel.brand_id || ':phone_e164:' || p_phone_e164));
  perform core.book_lock(v_channel.brand_id);
  select i.id, h.contact_id into v_identity_id, v_contact.id
  from core.contact_identities i
  join core.identity_holders h on h.identity_id = i.id and h.valid_to is null
  where i.brand_id = v_channel.brand_id and i.type = 'phone_e164' and i.value = p_phone_e164;

  if found then
    -- Existing bot tools lock the conversation before editing its contact or changing its holder.
    perform 1 from core.conversations where identity_id = v_identity_id order by id for update;
    select c.* into v_contact from public.contacts c
    join core.identity_holders h on h.contact_id = c.id and h.identity_id = v_identity_id and h.valid_to is null
    where c.id = v_contact.id for update of c;
    v_protected := not found;
  end if;

  if v_contact.id is not null then
    select coalesce(array_agg(id), '{}'::bigint[]) into v_deals
    from public.deals where primary_contact_id = v_contact.id;
    perform 1 from public.deals where id = any(v_deals) order by id for update;

    select coalesce(array_agg(id), '{}'::bigint[]) into v_conversations
    from core.conversations where contact_id = v_contact.id;

    v_protected := not v_contact.is_test or v_contact.brand_id <> v_channel.brand_id
      or exists (
        select 1 from core.identity_holders where contact_id = v_contact.id and identity_id <> v_identity_id
      ) or exists (
        select 1 from public.deals
        where (id = any(v_deals) and (not is_test or brand_id <> v_channel.brand_id
                                      or not (coalesce(contact_ids, '{}'::bigint[]) <@ array[v_contact.id])))
          or (not (id = any(v_deals)) and contact_ids @> array[v_contact.id])
      ) or exists (
        select 1 from core.appointments
        where (contact_id = v_contact.id or deal_id = any(v_deals))
          and (not is_test or brand_id <> v_channel.brand_id or contact_id <> v_contact.id or not (deal_id = any(v_deals)))
      ) or exists (
        select 1 from core.documents where deal_id = any(v_deals) and (not is_test or brand_id <> v_channel.brand_id)
      ) or exists (
        select 1 from core.conversations
        where (id = any(v_conversations) and (brand_id <> v_channel.brand_id or identity_id <> v_identity_id))
          or (not (id = any(v_conversations)) and superseded_by = any(v_conversations))
      );
  end if;

  insert into core.team_reset_receipts (channel_id, provider_message_hash)
  values (v_channel.id, sha256(convert_to(p_provider_message_id, 'UTF8')));

  if v_contact.id is not null and not v_protected then
    insert into core.team_reset_receipts (channel_id, provider_message_hash)
    select channel_id, sha256(convert_to(provider_message_id, 'UTF8')) from core.messages
    where conversation_id = any(v_conversations) and provider_message_id is not null
    on conflict do nothing;

    perform 1 from core.documents where deal_id = any(v_deals) order by id for update;
    select coalesce(array_agg(f.id), '{}'::bigint[]) into v_files
    from core.document_files f join core.documents d on d.id = f.document_id
    where d.deal_id = any(v_deals);

    -- Preserve rate accounting and leases already handed to the sender while erasing the
    -- content. A fenced request may finish, but an anonymized job cannot be retried.
    perform pg_advisory_xact_lock(hashtext('salvionix_outbox_pacing'));
    update core.outbox o
    set conversation_id = null, document_file_id = null, destination = '', body = '',
        status = 'failed', last_error = 'team_reset', send_started_at = null
    where (o.conversation_id = any(v_conversations) or o.document_file_id = any(v_files))
      and (o.claim_expires_at > clock_timestamp() or exists (
        select 1 from core.outbox_send_attempts a
        where a.outbox_id = o.id and a.started_at > clock_timestamp() - interval '3 minutes'
      ));
    delete from core.outbox where conversation_id = any(v_conversations) or document_file_id = any(v_files);

    perform set_config('core.team_reset_contact_id', v_contact.id::text, true);
    delete from core.document_files where id = any(v_files);
    delete from core.documents where deal_id = any(v_deals);
    delete from core.appointments where deal_id = any(v_deals);
    delete from core.quotes where deal_id = any(v_deals);
    perform set_config('core.team_reset_contact_id', '', true);

    delete from core.reply_reviews where conversation_id = any(v_conversations);
    delete from core.offered_slots where conversation_id = any(v_conversations);
    delete from core.messages where conversation_id = any(v_conversations);
    delete from core.conversations where id = any(v_conversations);
    delete from core.identity_holders where contact_id = v_contact.id;
    delete from public.deals where id = any(v_deals);
    delete from public.contacts where id = v_contact.id;
    delete from core.contact_identities i where i.id = v_identity_id
      and not exists (select 1 from core.identity_holders h where h.identity_id = i.id)
      and not exists (select 1 from core.conversations v where v.identity_id = i.id);
  end if;

  insert into core.outbox (brand_id, channel_id, destination, body, sender)
  values (v_channel.brand_id, v_channel.id, p_chat_id,
          case when v_protected then 'No reinicié la conversación porque hay datos fuera del entorno de pruebas.'
               else 'Listo. Reinicié tu conversación y borré tus datos de prueba.' end, 'human');
  return case when v_protected then 'protected' else 'reset' end;
end;
$$;

-- New contacts on an approved team number are test leads even on a real channel.
create or replace function api.ingest_inbound(
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
  ) or exists (
    select 1 from core.team_reset_receipts where channel_id = channel.id and provider_message_hash = sha256(convert_to(p_provider_message_id, 'UTF8'))
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
      channel.is_test or exists (
        select 1 from core.team_reset_numbers where brand_id = brand.id and phone_e164 = p_phone_e164
      ),
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
