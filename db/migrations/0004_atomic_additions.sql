-- Additive changes to Atomic tables. contacts_summary names its columns one by one, so it keeps working.

alter table public.contacts
  add column brand_id bigint not null default 1 references core.brands (id),
  add column is_test boolean not null default false,
  add column preferred_language text;

alter table public.deals
  add column brand_id bigint not null default 1 references core.brands (id),
  add column primary_contact_id bigint references public.contacts (id),
  add column is_test boolean not null default false,
  add column zip text;

create index deals_primary_contact_idx on public.deals (primary_contact_id);

-- The Atomic version calls gravatar from inside the database with a hash of the customer's email.
-- Same signature, so handle_contact_saved keeps working.
create or replace function public.get_avatar_for_email(email text) returns text
  language sql immutable
  as $$ select null::text $$;
