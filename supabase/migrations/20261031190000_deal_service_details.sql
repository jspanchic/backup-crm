-- Optional service details for residential and business opportunities.
-- Existing opportunities remain unchanged and no service data is inferred.
alter table public.deals
  add column service_space_type text,
  add column service_address text,
  add column service_space_size text,
  add column service_visit_date date,
  add column service_visit_time time without time zone;
