-- Empties everything customers and the bot create on the TEST stack, and keeps the configuration
-- (brands, channels, price lists, technicians and their availability, responsible people, real document counters).
-- Same list as `db-seed-presentacion --reset`; TRUNCATE ... CASCADE also empties what hangs from these tables
-- (conversations, messages, outbox, quotes, appointments, documents, document_files, reply_reviews, offered_slots).
-- Run on the test VPS only, as the postgres superuser inside the db container (guide, section g):
--   docker compose exec -T db psql -U postgres -d salvionix -v ON_ERROR_STOP=1 < clean-test-data.sql
-- The PDF files live in the documents volume: the guide removes them in a second step.
\set ON_ERROR_STOP on
begin;

truncate table
  public.contacts, public.deals, public.companies, public.tasks, public.contact_notes, public.deal_notes,
  core.contact_identities, core.unrouted_events
restart identity cascade;

-- The test numbering series (PRUEBA-COT, PRUEBA-OC, PRUEBA-OT) starts again; the real series (COT, OC, OT) is not touched.
update core.document_counters set last_number = 0 where is_test;

commit;

-- What is left (row counts). The first block must be all zeros; the second is the configuration that stays.
select 'contacts' as tabla, count(*) as filas from public.contacts
union all select 'companies', count(*) from public.companies
union all select 'deals', count(*) from public.deals
union all select 'tasks', count(*) from public.tasks
union all select 'contact_notes', count(*) from public.contact_notes
union all select 'deal_notes', count(*) from public.deal_notes
union all select 'core.contact_identities', count(*) from core.contact_identities
union all select 'core.unrouted_events', count(*) from core.unrouted_events
union all select 'core.conversations', count(*) from core.conversations
union all select 'core.messages', count(*) from core.messages
union all select 'core.outbox', count(*) from core.outbox
union all select 'core.quotes', count(*) from core.quotes
union all select 'core.appointments', count(*) from core.appointments
union all select 'core.documents', count(*) from core.documents
union all select 'core.document_files', count(*) from core.document_files
union all select 'core.reply_reviews', count(*) from core.reply_reviews
union all select 'core.offered_slots', count(*) from core.offered_slots
order by 1;

select 'config: brands' as tabla, count(*) as filas from core.brands
union all select 'config: channels', count(*) from core.channels
union all select 'config: technicians', count(*) from core.technicians
union all select 'config: price_lists', count(*) from core.price_lists
union all select 'config: sales', count(*) from public.sales
order by 1;