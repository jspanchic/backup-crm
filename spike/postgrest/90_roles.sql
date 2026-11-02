-- CRM-T1 spike: privileges of the PostgREST role. This file is the permission list for Joel.
-- Principle: nothing is granted by default; everything below is explicit.

-- 1. Strip what the Supabase-style 06_grants.sql gave to the placeholder roles.
revoke all on all tables    in schema public from anon, authenticated, service_role, public;
revoke all on all sequences in schema public from anon, authenticated, service_role, public;
revoke all on all functions in schema public from anon, authenticated, service_role, public;
revoke all on schema public from anon, authenticated, service_role, crm_anon, crm_api;

-- 2. crm_api: what the CRM frontend may do.
grant usage on schema public to crm_api, crm_anon;

grant select, insert, update, delete on
  public.companies, public.contacts, public.contact_notes, public.deals, public.deal_notes,
  public.tags, public.tasks
to crm_api;

grant select, update on public.configuration to crm_api;
grant select on public.sales to crm_api;
grant update (first_name, last_name, avatar) on public.sales to crm_api;

-- Views (security_invoker = on, so RLS of the underlying tables still applies)
grant select on public.activity_log, public.contacts_summary, public.companies_summary to crm_api;

-- Sequences used by inserts
grant usage on all sequences in schema public to crm_api;

-- Functions the frontend calls directly (rpc) or that policies/triggers evaluate as crm_api
grant execute on function public.is_admin() to crm_api;

-- 3. Found during the spike (create contact / create deal failed without them).
-- The trigger functions below are NOT security definer, so they run with crm_api's rights.
--   set_sales_id_default()  calls auth.uid()
--   handle_contact_saved()  calls get_avatar_for_email() -> extensions.digest / extensions.http_get
grant usage on schema auth to crm_api;
grant execute on function auth.uid() to crm_api;
grant usage on schema extensions to crm_api;
grant execute on function public.get_avatar_for_email(text), public.get_domain_favicon(text) to crm_api;
-- 4. Search helpers used by the generated/trigger-maintained fts columns and by the global_search rpc.
grant execute on function
  public.search_document(variadic text[]), public.search_unaccent(text),
  public.search_query(text), public.search_attachment_titles(jsonb[]),
  public.global_search(text, text[], integer)
to crm_api;
-- 5. Won-deal follow-up: create_deal_followup_on_win() is not security definer and inserts into this table as crm_api.
-- Note: migration 20261031210000 grants select, insert to "authenticated"; supabase/schemas/06_grants.sql does not (drift, reported in ADR-001).
grant select, insert on public.deal_followup_events to crm_api;