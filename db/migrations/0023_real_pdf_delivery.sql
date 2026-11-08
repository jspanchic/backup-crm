-- The brand switch applies to real customer files from the bot and from the panel.
-- Enqueueing a document also writes to the conversation; reject the statement atomically.
create function core.guard_real_pdf_delivery() returns trigger
  language plpgsql
  set search_path = ''
  as $$
declare
  allowed boolean;
begin
  select d.is_test or b.pdf_clientes_reales into allowed
  from core.document_files f
  join core.documents d on d.id = f.document_id
  join core.brands b on b.id = d.brand_id
  where f.id = new.document_file_id and b.id = new.brand_id
  for share of b;

  if allowed is distinct from true then
    raise exception 'PDF delivery to real customers is disabled for this brand'
      using errcode = 'CX002', hint = 'pdf_real_disabled';
  end if;
  return new;
end;
$$;

create trigger guard_real_pdf_delivery before insert on core.outbox
  for each row when (new.document_file_id is not null)
  execute function core.guard_real_pdf_delivery();

-- Discard queued work so enabling the switch again cannot send stale files. A fenced request
-- remains in flight so the worker can still record its delivery outcome without replaying it.
create function core.cancel_real_pdf_outbox(p_brand_id bigint) returns void
  language sql
  set search_path = ''
  as $$
    update core.outbox o
    set status = case when o.status = 'sending' and o.send_started_at is not null then 'sending' else 'failed' end,
        last_error = 'pdf_real_disabled'
    from core.document_files f join core.documents d on d.id = f.document_id
    where o.brand_id = p_brand_id and o.document_file_id = f.id and not d.is_test
      and o.status in ('pending', 'sending')
  $$;

create function core.stop_brand_pdf_delivery() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  perform core.cancel_real_pdf_outbox(new.id);
  return new;
end;
$$;

create trigger stop_brand_pdf_delivery before update of pdf_clientes_reales on core.brands
  for each row when (old.pdf_clientes_reales and not new.pdf_clientes_reales)
  execute function core.stop_brand_pdf_delivery();

select core.cancel_real_pdf_outbox(id) from core.brands where not pdf_clientes_reales;

create or replace function api.document_target(p_conversation_id bigint) returns jsonb
  language sql stable
  security definer
  set search_path = ''
  as $$
    select jsonb_build_object(
      'deal_id', d.id,
      'is_test', d.is_test,
      'pdf_clientes_reales', b.pdf_clientes_reales,
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
    join core.brands b on b.id = d.brand_id
    where cv.id = p_conversation_id
  $$;
