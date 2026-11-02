-- Cluster-level roles. Runs with a superuser, once per server, and is safe to re-run.
-- Passwords are set by core-api/scripts/db-bootstrap.ts from the environment, never here.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('core_owner', true),     -- owns everything; used only to run migrations
      ('core_api', true),       -- core-api: EXECUTE on schema api, no direct table access
      ('authenticator', true),  -- PostgREST connection role, can only switch to crm_api / crm_anon
      ('crm_api', false),       -- role named in the panel JWT
      ('crm_anon', false),      -- PostgREST role for requests without a valid JWT
      ('authenticated', false), -- referenced by the Atomic RLS policies; crm_api is a member
      ('anon', false),          -- referenced by the Atomic grants; stripped in 0009_permissions
      ('service_role', false)   -- same
    ) as t(name, can_login)
  loop
    if not exists (select 1 from pg_roles where rolname = r.name) then
      execute format('create role %I %s', r.name, case when r.can_login then 'login' else 'nologin' end);
    end if;
  end loop;
end
$$;

alter role authenticator noinherit;
alter role crm_api inherit;
grant authenticated to crm_api;
grant crm_api, crm_anon to authenticator;
