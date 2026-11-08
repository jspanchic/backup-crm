-- Keep the exact follow-up so an operator can resolve the escalation safely.
alter table core.conversations add column escalation_task_id bigint references public.tasks (id) on delete set null;

create or replace function api.escalate(p_conversation_id bigint, p_reason text) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  conversation core.conversations;
  brand core.brands;
  contact public.contacts;
  v_task_id bigint;
begin
  select * into conversation from core.conversations where id = p_conversation_id for update;
  if conversation.bot_paused then
    return jsonb_build_object('pausado', true, 'ya_estaba_pausado', true);
  end if;
  select * into brand from core.brands where id = conversation.brand_id;
  select * into contact from public.contacts where id = conversation.contact_id;

  insert into public.tasks (contact_id, type, text, due_date, sales_id)
  values (contact.id, 'follow-up', 'Atender a mano: el bot pidió ayuda. Motivo: ' || left(p_reason, 300), now(), brand.default_sales_id)
  returning id into v_task_id;

  update core.conversations
  set bot_paused = true, bot_paused_at = now(), bot_paused_reason = left(p_reason, 300), escalation_task_id = v_task_id
  where id = conversation.id;

  return jsonb_build_object('pausado', true, 'ya_estaba_pausado', false);
end;
$$;
