-- Entry points for core-api. Every function here is security definer, owned by core_owner,
-- with an empty search_path. The business functions arrive in later migrations (CRM-T5, T6, T9, T10).

create function api.health() returns boolean
  language sql stable
  security definer
  set search_path = ''
  as $$ select true $$;
