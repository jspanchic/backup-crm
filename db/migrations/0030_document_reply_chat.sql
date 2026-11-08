-- Automatic PDFs use the inbound address. A manual send still uses the latest address.
drop trigger snapshot_document_destination on core.outbox;
drop function core.snapshot_document_destination();

create function api.enqueue_document(
  p_document_id bigint, p_file_id bigint, p_caption text, p_sender text, p_inbound_message_id bigint
) returns bigint
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

  if p_inbound_message_id is null then
    select * into v_conversation
    from core.conversations
    where contact_id = v_contact_id and brand_id = v_document.brand_id and closed_at is null and superseded_by is null
    order by opened_at desc limit 1;
  else
    select c.* into v_conversation
    from core.conversations c
    join core.messages m on m.conversation_id = c.id and m.brand_id = c.brand_id and m.channel_id = c.channel_id
    where m.id = p_inbound_message_id and m.direction = 'in'
      and c.contact_id = v_contact_id and c.brand_id = v_document.brand_id
      and c.closed_at is null and c.superseded_by is null;
  end if;
  if not found then
    raise exception 'the customer has no open conversation' using errcode = 'CX002', hint = 'no_conversation';
  end if;
  select * into v_identity from core.contact_identities where id = v_conversation.identity_id;

  insert into core.messages (brand_id, conversation_id, channel_id, direction, sender, body, sent_at)
  values (v_conversation.brand_id, v_conversation.id, v_conversation.channel_id, 'out', p_sender, p_caption, now());

  insert into core.outbox (brand_id, channel_id, conversation_id, destination, body, document_file_id, sender)
  values (
    v_conversation.brand_id, v_conversation.channel_id, v_conversation.id,
    coalesce(
      core.outbox_chat_id(v_conversation.brand_id, v_conversation.channel_id, v_conversation.id, p_inbound_message_id),
      case v_identity.type when 'phone_e164' then substr(v_identity.value, 2) || '@c.us' else v_identity.value end
    ),
    p_caption, p_file_id, p_sender
  )
  returning id into v_outbox_id;
  return v_outbox_id;
end;
$$;

create or replace function api.enqueue_document(
  p_document_id bigint, p_file_id bigint, p_caption text, p_sender text default 'human'
) returns bigint
  language sql
  security definer
  set search_path = ''
  as $$
    select api.enqueue_document(p_document_id, p_file_id, p_caption, p_sender, null::bigint)
  $$;
