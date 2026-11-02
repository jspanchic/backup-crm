-- Platform layer: the minimum of Supabase that the Atomic schema expects, plus our own schemas.
-- Keeping this compatibility layer lets backoffice/supabase/schemas load unmodified.

create schema if not exists core;  -- own tables; never exposed by PostgREST
create schema if not exists api;   -- functions for core-api
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists net;
create schema if not exists extensions;

create extension if not exists citext schema extensions;
create extension if not exists unaccent schema extensions;
create extension if not exists btree_gist schema extensions;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  is_sso_user boolean not null default false
);

-- auth.uid() reads the "sub" claim that PostgREST puts in request.jwt.claims.
create function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'sub', '')::uuid $$;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid
);
alter table storage.objects enable row level security;

-- Attachment cleanup webhooks go nowhere: attachments are out of Delivery 1.
create function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer)
  returns bigint
  language sql
  as $$ select 0::bigint $$;
