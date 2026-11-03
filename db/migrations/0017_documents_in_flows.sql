-- Documents inside the bot flow and the panel (CRM-T14c).

-- 1. The deal a conversation is about and the live appointment it has: what the bot flow needs to issue documents.
--    Same rule as core.deal_facts: the open deal, or the last one once the sale closed.
create function api.document_target(p_conversation_id bigint) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object(
      'deal_id', d.id,
      'is_test', d.is_test,
      'appointment_id', (
        select a.id from core.appointments a
        where a.deal_id = d.id and a.status in ('hold', 'confirmed')
        order by a.id desc limit 1
      )
    )
    from core.conversations cv
    join lateral (
      select * from public.deals x
      where x.primary_contact_id = cv.contact_id and x.archived_at is null
      order by (x.stage not in ('won', 'lost')) desc, x.id desc
      limit 1
    ) d on true
    where cv.id = p_conversation_id
  $$;

-- 2. A purchase or work order no longer needs the caller to name the appointment: it is the deal's newest live one
--    (held or confirmed for a purchase order, confirmed for a work order). Naming one is still allowed.
create or replace function api.issue_document(p_deal_id bigint, p_document_type text, p_appointment_id bigint default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  v_deal public.deals;
  v_quote core.quotes;
  v_brand core.brands;
  v_contact public.contacts;
  v_document core.documents;
  v_created boolean := false;
  v_appointment_id bigint := p_appointment_id;
  v_start timestamptz;
  v_end timestamptz;
  v_address text;
  v_technician text;
  v_appointment_deal bigint;
begin
  if p_document_type not in ('quote', 'purchase_order', 'work_order') then
    raise exception 'unknown document type' using errcode = 'CX004', hint = 'invalid_document_type';
  end if;
  if p_document_type = 'quote' and p_appointment_id is not null then
    raise exception 'a quote takes no appointment' using errcode = 'CX004', hint = 'appointment_mismatch';
  end if;

  select * into v_deal from public.deals where id = p_deal_id;
  if not found then
    raise exception 'unknown deal' using errcode = 'CX004', hint = 'unknown_deal';
  end if;
  select * into v_quote from core.quotes where deal_id = p_deal_id order by version desc limit 1;
  if not found then
    raise exception 'the deal has no quote yet' using errcode = 'CX002', hint = 'no_quote';
  end if;

  if p_document_type <> 'quote' and v_appointment_id is null then
    select a.id into v_appointment_id
    from core.appointments a
    where a.deal_id = p_deal_id
      and a.status = any (case p_document_type when 'purchase_order' then array['hold', 'confirmed'] else array['confirmed'] end)
    order by a.id desc limit 1;
    if v_appointment_id is null then
      raise exception 'the deal has no appointment for this document' using errcode = 'CX002', hint = 'no_appointment';
    end if;
  end if;

  v_document := core.find_live_document(p_document_type, v_quote.id, v_appointment_id);
  if v_document.id is null then
    if v_appointment_id is not null then
      select a.deal_id, a.start_at, a.end_at, a.address, t.name
        into v_appointment_deal, v_start, v_end, v_address, v_technician
      from core.appointments a join core.technicians t on t.id = a.technician_id
      where a.id = v_appointment_id;
      if v_appointment_deal is distinct from p_deal_id then
        raise exception 'the appointment does not belong to this deal' using errcode = 'CX004', hint = 'unknown_appointment';
      end if;
    end if;

    select * into v_brand from core.brands where id = v_deal.brand_id;
    select * into v_contact from public.contacts where id = coalesce(v_deal.primary_contact_id, v_deal.contact_ids[1]);

    begin
      insert into core.documents (document_type, deal_id, quote_id, appointment_id, payload)
      values (
        p_document_type, p_deal_id, v_quote.id, v_appointment_id,
        jsonb_build_object(
          'brand_name', v_brand.name,
          'timezone', v_brand.timezone,
          'customer_name', nullif(btrim(coalesce(v_contact.first_name, '') || ' ' || coalesce(v_contact.last_name, '')), ''),
          'deal_name', v_deal.name,
          'service_space_type', v_deal.service_space_type,
          'service_space_size', v_deal.service_space_size,
          'service_address', coalesce(v_address, v_deal.service_address),
          'quote_valid_until', v_quote.valid_until,
          'appointment_start_at', v_start,
          'appointment_end_at', v_end,
          'technician_name', v_technician
        )
      )
      returning * into v_document;
      v_created := true;
    exception when unique_violation then
      -- Another request issued it between the look-up and the insert.
      v_document := core.find_live_document(p_document_type, v_quote.id, v_appointment_id);
    end;
  end if;

  return jsonb_build_object(
    'id', v_document.id, 'display_number', v_document.display_number, 'document_type', v_document.document_type,
    'is_test', v_document.is_test, 'status', v_document.status, 'created', v_created
  );
end;
$$;

-- 3. Who the message in the conversation comes from: a person in the panel, or the bot.
drop function api.enqueue_document(bigint, bigint, text);
create function api.enqueue_document(p_document_id bigint, p_file_id bigint, p_caption text, p_sender text default 'human') returns bigint
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

  insert into core.outbox (brand_id, channel_id, conversation_id, destination, body, document_file_id)
  values (
    v_conversation.brand_id, v_conversation.channel_id, v_conversation.id,
    case v_identity.type when 'phone_e164' then substr(v_identity.value, 2) || '@c.us' else v_identity.value end,
    p_caption, p_file_id
  )
  returning id into v_outbox_id;
  return v_outbox_id;
end;
$$;

-- 4. What the deal's "Documents" section shows: its documents with their file and delivery, and which ones can be
--    issued now (the prerequisite exists and the live document of that kind does not).
create function api.list_documents(p_deal_id bigint) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    with latest_quote as (
      select id from core.quotes where deal_id = p_deal_id order by version desc limit 1
    ), purchase_appointment as (
      select id from core.appointments where deal_id = p_deal_id and status in ('hold', 'confirmed') order by id desc limit 1
    ), work_appointment as (
      select id from core.appointments where deal_id = p_deal_id and status = 'confirmed' order by id desc limit 1
    )
    select jsonb_build_object(
      'documents', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', d.id, 'display_number', d.display_number, 'document_type', d.document_type, 'is_test', d.is_test,
          'status', d.status, 'issued_at', d.issued_at, 'appointment_id', d.appointment_id,
          'file', (select jsonb_build_object('id', f.id, 'size_bytes', f.size_bytes)
                   from core.document_files f where f.document_id = d.id order by f.id desc limit 1),
          'sent_at', (select max(o.sent_at) from core.outbox o join core.document_files f on f.id = o.document_file_id
                      where f.document_id = d.id and o.status = 'sent'),
          'send_status', (select o.status from core.outbox o join core.document_files f on f.id = o.document_file_id
                          where f.document_id = d.id order by o.id desc limit 1)
        ) order by d.id desc)
        from core.documents d where d.deal_id = p_deal_id
      ), '[]'::jsonb),
      'can_issue', jsonb_build_object(
        'quote', exists (select 1 from latest_quote q where core.find_live_document('quote', q.id, null) is null),
        'purchase_order', exists (
          select 1 from latest_quote q, purchase_appointment a
          where core.find_live_document('purchase_order', q.id, a.id) is null),
        'work_order', exists (
          select 1 from latest_quote q, work_appointment a
          where core.find_live_document('work_order', q.id, a.id) is null)
      )
    )
  $$;
