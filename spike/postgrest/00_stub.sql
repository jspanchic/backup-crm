-- CRM-T1 spike: minimal replacement for the Supabase platform pieces the schema needs.
-- Not a production file. Variables: authenticator_password (psql -v).

-- Roles. anon/authenticated/service_role exist only because 06_grants.sql and the RLS
-- policies reference them; they are stripped of privileges in 90_roles.sql.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create role crm_anon nologin;          -- PostgREST role for requests without a valid JWT: no privileges
create role crm_api nologin;           -- role named in the JWT "role" claim
grant authenticated to crm_api;        -- so policies "to authenticated" apply to crm_api
create role authenticator login noinherit password :'authenticator_password';
grant crm_api, crm_anon to authenticator;

create schema auth;
create schema storage;
create schema extensions;
create schema net;
create extension if not exists citext schema extensions;
create extension if not exists pgcrypto schema extensions;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  is_sso_user boolean not null default false
);

-- auth.uid() reads the "sub" claim that PostgREST puts in the request.jwt.claims setting.
create function auth.uid() returns uuid language sql stable as
$$ select nullif(coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'sub', '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid
);
alter table storage.objects enable row level security;
insert into storage.buckets (id, name) values ('attachments', 'attachments');

-- The "http" extension is not in the stock image; the avatar lookup is replaced by a stub.
create function extensions.http_get(uri text) returns table(status integer) language sql as $$ select 404 $$;
-- pg_net stub: attachment cleanup webhooks go nowhere in the spike.
create function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer)
returns bigint language sql as $$ select 0::bigint $$;
