-- Default-deny: everything is revoked, then each permission is granted by name.
-- This is the list Joel reviews. See docs/decisiones/ADR-001-proveedor-datos.md.

-- 1. What the Atomic baseline and Postgres defaults hand out
revoke all on all tables in schema public from anon, authenticated, service_role, public;
revoke all on all sequences in schema public from anon, authenticated, service_role, public;
revoke all on all functions in schema public from anon, authenticated, service_role, public;
revoke all on schema public from anon, authenticated, service_role, public;
revoke all on all functions in schema api, core, auth, net from public;

-- Functions created by later migrations start without PUBLIC access
alter default privileges for role core_owner revoke execute on functions from public;
alter default privileges for role core_owner in schema api grant execute on functions to core_api;

-- 2. core_api: functions only, never tables
grant usage on schema api to core_api;
grant execute on all functions in schema api to core_api;

-- 3. crm_api: what the panel may do through PostgREST
grant usage on schema public to crm_api, crm_anon;
grant usage on schema auth, extensions to crm_api;

grant select, insert, update, delete on
  public.companies, public.contacts, public.contact_notes,
  public.deals, public.deal_notes, public.tags, public.tasks
to crm_api;
grant select, update on public.configuration to crm_api;
grant select on public.sales to crm_api;
grant update (first_name, last_name, avatar) on public.sales to crm_api;

-- create_deal_followup_on_win is not security definer: it inserts here with the caller's rights.
-- core-api does not let this table through its proxy.
grant select, insert on public.deal_followup_events to crm_api;

grant select on
  public.activity_log, public.contacts_summary, public.companies_summary, public.appointments_summary
to crm_api;

grant usage on all sequences in schema public to crm_api;

-- Trigger and policy helpers that run with the caller's rights, plus the one rpc the panel uses
grant execute on function
  auth.uid(),
  public.is_admin(),
  public.global_search(text, text[], integer),
  public.search_document(variadic text[]),
  public.search_unaccent(text),
  public.search_query(text),
  public.search_attachment_titles(jsonb[]),
  public.get_avatar_for_email(text)
to crm_api;
