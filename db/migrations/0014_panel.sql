-- CRM-T8b: what the full panel needs from the database.
--  1. The conversation of a contact, readable by the panel and by nothing else.
--  2. Test leads out of the reports: tasks, notes, the activity log and the contact list carry the mark too.
--  3. The panel settings row. The panel can only edit it (crm_api has no insert), and without it the panel does not start.

insert into public.configuration (id) values (1) on conflict do nothing;

-- 1. Conversation ----------------------------------------------------------------------------------
-- A view owned by core_owner (not security_invoker): crm_api reads it without getting access to schema core.
-- A conversation keeps the contact it was opened for, so after a number is reassigned the previous
-- holder still has the history that was theirs.
create view public.conversation_messages as
select
  m.id,
  c.contact_id,
  m.conversation_id,
  m.direction,
  m.sender,
  m.body,
  m.sent_at
from core.messages m
join core.conversations c on c.id = m.conversation_id;

grant select on public.conversation_messages to crm_api;

-- 2. Test leads ------------------------------------------------------------------------------------
alter table public.tasks add column is_test boolean not null default false;
alter table public.contact_notes add column is_test boolean not null default false;
alter table public.deal_notes add column is_test boolean not null default false;

-- A task or a note of a test lead is a test, whoever creates it.
create function core.task_follows_contact() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if not new.is_test and exists (select 1 from public.contacts c where c.id = new.contact_id and c.is_test) then
    new.is_test := true;
  end if;
  return new;
end;
$$;
create trigger task_follows_contact before insert on public.tasks
  for each row execute function core.task_follows_contact();
create trigger contact_note_follows_contact before insert on public.contact_notes
  for each row execute function core.task_follows_contact();

create function core.deal_note_follows_deal() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if not new.is_test and exists (select 1 from public.deals d where d.id = new.deal_id and d.is_test) then
    new.is_test := true;
  end if;
  return new;
end;
$$;
create trigger deal_note_follows_deal before insert on public.deal_notes
  for each row execute function core.deal_note_follows_deal();

-- When a lead becomes a test (a "Prueba X" name, or by hand), what already hangs from it follows.
-- Like the mark itself, this is never undone by itself.
create function core.spread_test_contact_children() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if new.is_test and (tg_op = 'INSERT' or not old.is_test) then
    update public.tasks set is_test = true where contact_id = new.id and not is_test;
    update public.contact_notes set is_test = true where contact_id = new.id and not is_test;
  end if;
  return null;
end;
$$;
create trigger spread_test_contact_children after insert or update on public.contacts
  for each row execute function core.spread_test_contact_children();

create function core.spread_test_deal() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if new.is_test and (tg_op = 'INSERT' or not old.is_test) then
    update public.deal_notes set is_test = true where deal_id = new.id and not is_test;
  end if;
  return null;
end;
$$;
create trigger spread_test_deal after insert or update on public.deals
  for each row execute function core.spread_test_deal();

-- The contact list and the activity log say which rows are tests (new column at the end of each view).
create or replace view public.contacts_summary as
select
  co.id,
  co.first_name,
  co.last_name,
  co.gender,
  co.title,
  co.background,
  co.avatar,
  co.first_seen,
  co.last_seen,
  co.has_newsletter,
  co.status,
  co.tags,
  co.company_id,
  co.sales_id,
  co.linkedin_url,
  co.email_jsonb,
  co.phone_jsonb,
  (jsonb_path_query_array(co.email_jsonb, '$[*]."email"'::jsonpath))::text as email_fts,
  (jsonb_path_query_array(co.phone_jsonb, '$[*]."number"'::jsonpath))::text as phone_fts,
  c.name as company_name,
  count(distinct t.id) filter (where t.done_date is null) as nb_tasks,
  co.is_test
from public.contacts co
  left join public.tasks t on co.id = t.contact_id
  left join public.companies c on co.company_id = c.id
group by co.id, c.name;

create or replace view public.activity_log with (security_invoker = on) as
select
    ('company.' || c.id || '.created') as id,
    'company.created' as type,
    c.created_at as date,
    c.id as company_id,
    c.sales_id,
    (to_jsonb(c.*) - 'fts')::json as company,
    null::json as contact,
    null::json as deal,
    null::json as contact_note,
    null::json as deal_note,
    false as is_test
from public.companies c
union all
select
    ('contact.' || co.id || '.created'),
    'contact.created',
    co.first_seen,
    co.company_id,
    co.sales_id,
    null::json,
    (to_jsonb(co.*) - 'fts')::json,
    null::json,
    null::json,
    null::json,
    co.is_test
from public.contacts co
union all
select
    ('contactNote.' || cn.id || '.created'),
    'contactNote.created',
    cn.date,
    co.company_id,
    cn.sales_id,
    null::json,
    null::json,
    null::json,
    (to_jsonb(cn.*) - 'fts')::json,
    null::json,
    cn.is_test
from public.contact_notes cn
    left join public.contacts co on co.id = cn.contact_id
union all
select
    ('deal.' || d.id || '.created'),
    'deal.created',
    d.created_at,
    d.company_id,
    d.sales_id,
    null::json,
    null::json,
    (to_jsonb(d.*) - 'fts')::json,
    null::json,
    null::json,
    d.is_test
from public.deals d
union all
select
    ('dealNote.' || dn.id || '.created'),
    'dealNote.created',
    dn.date,
    d.company_id,
    dn.sales_id,
    null::json,
    null::json,
    null::json,
    null::json,
    (to_jsonb(dn.*) - 'fts')::json,
    dn.is_test
from public.deal_notes dn
    left join public.deals d on d.id = dn.deal_id;
